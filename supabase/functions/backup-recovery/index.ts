
/**
 * RBCCMS Backup & Recovery
 *
 * Free manual Full Backup for school demonstration.
 *
 * Full Backup:
 * 1. Exports Firestore records as JSON.
 * 2. Creates a Supabase photo snapshot.
 * 3. Stores a combined backup manifest.
 * 4. Allows the Admin to download one ZIP.
 *
 * Existing photo backup, download and recovery
 * features remain available.
 *
 * Automatic FULL backup is not enabled.
 */

import {
  cert,
  getApps,
  initializeApp
} from 'npm:firebase-admin@13/app';

import {
  getAuth
} from 'npm:firebase-admin@13/auth';

import {
  FieldValue,
  Timestamp,
  GeoPoint,
  DocumentReference,
  initializeFirestore
} from 'npm:firebase-admin@13/firestore';

import {
  createClient
} from 'npm:@supabase/supabase-js@2';

import {
  zipSync,
  strToU8
} from 'npm:fflate@0.8.2';

// ========================================
// CONFIGURATION
// ========================================

const PROJECT = 'rbccms-system';

const SOURCE_BUCKETS = [
  'concern-photos',
  'profile-photos'
] as const;

const BACKUP_BUCKET = 'rbccms-backups';

const MAX_FILES = 200;
const MAX_BYTES = 250 * 1024 * 1024;
const MAX_LISTING = 2000;
const MAX_RESTORE_FILES = 200;

const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;

const MAX_DB_DOCUMENTS = 2000;
const MAX_DB_COLLECTIONS = 100;
const MAX_DB_DEPTH = 10;
const MAX_DB_EXPORT_BYTES = 8 * 1024 * 1024;

const SNAPSHOT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ORIGINS = new Set(
  (
    Deno.env.get('ALLOWED_ORIGINS') ??
    'http://localhost:4200,http://127.0.0.1:4200'
  )
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

// ========================================
// TYPES
// ========================================

type Action =
  | 'overview'
  | 'photo-backup'
  | 'photo-preview'
  | 'photo-recover-missing'
  | 'photo-download'
  | 'scheduled-photo-backup'
  | 'full-backup'
  | 'full-download';

type FileEntry = {
  bucket: string;
  path: string;
  backupPath: string;
  bytes: number;
  sha256: string;
  contentType: string;
};

type Manifest = {
  version: 1;
  id: string;
  createdAt: string;
  files: FileEntry[];
  totalBytes: number;
};

type FullBackupRun = {
  version: 2;
  id: string;
  createdAt: string;
  status: 'COMPLETED';

  firestore: {
    state: 'COMPLETED';
    documentCount: number;
    collectionCount: number;
    totalBytes: number;
    sha256: string;
    backupPath: string;
  };

  photos: {
    state: 'COMPLETED';
    snapshotId: string;
    fileCount: number;
    totalBytes: number;
  };
};

class Failure extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// ========================================
// FIREBASE ADMIN
// ========================================

function app() {
  if (getApps().length) {
    return getApps()[0];
  }

  const raw = Deno.env.get(
    'FIREBASE_SERVICE_ACCOUNT'
  );

  if (!raw) {
    throw new Failure(
      503,
      'Firebase service credentials not configured.'
    );
  }

  let account: Record<string, unknown>;

  try {
    account = JSON.parse(raw);
  } catch {
    throw new Failure(
      503,
      'Invalid Firebase service credentials.'
    );
  }

  if (account.project_id !== PROJECT) {
    throw new Failure(
      503,
      'Wrong Firebase project.'
    );
  }

  if (
    typeof account.client_email !== 'string' ||
    typeof account.private_key !== 'string'
  ) {
    throw new Failure(
      503,
      'Firebase service-account details are incomplete.'
    );
  }

  return initializeApp({
    credential: cert({
      projectId: PROJECT,
      clientEmail: account.client_email,
      privateKey: account.private_key
    }),
    projectId: PROJECT
  });
}

// ========================================
// FIRESTORE
// ========================================

let firestoreDatabase:
  | ReturnType<typeof initializeFirestore>
  | undefined;

function firestore() {
  if (!firestoreDatabase) {
    firestoreDatabase = initializeFirestore(
      app(),
      {
        preferRest: true
      }
    );
  }

  return firestoreDatabase;
}

// ========================================
// SUPABASE STORAGE
// ========================================

function storage() {
  const url = Deno.env.get('SUPABASE_URL');

  const backupKey = Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY'
  );

  const keyMap = Deno.env.get(
    'SUPABASE_SECRET_KEYS'
  );

  let key = backupKey;

  if (keyMap) {
    try {
      key = JSON.parse(keyMap).default || key;
    } catch {
      throw new Failure(
        503,
        'Supabase secret configuration is invalid.'
      );
    }
  }

  if (!url || !key) {
    throw new Failure(
      503,
      'Supabase Storage is not configured.'
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }).storage;
}

// ========================================
// VERIFY APPROVED ADMIN
// ========================================

async function adminActor(
  request: Request
) {
  const match = request.headers
    .get('authorization')
    ?.match(/^Bearer (\S+)$/i);

  if (!match) {
    throw new Failure(
      401,
      'Please sign in as an administrator.'
    );
  }

  let decoded;

  try {
    decoded = await getAuth(app())
      .verifyIdToken(match[1], true);
  } catch {
    throw new Failure(
      401,
      'Firebase login session expired or revoked.'
    );
  }

  const snapshot = await firestore()
    .doc(`users/${decoded.uid}`)
    .get();

  if (
    snapshot.data()?.role !== 'admin' ||
    snapshot.data()?.accountStatus !== 'approved'
  ) {
    throw new Failure(
      403,
      'Only approved administrators can manage backups.'
    );
  }

  return {
    uid: decoded.uid,
    name: String(
      snapshot.data()?.name || 'Administrator'
    ),
    authTime: decoded.auth_time
  };
}

// ========================================
// SCHEDULER SECRET
// ========================================

function matchesSecret(
  provided: string,
  expected: string
): boolean {
  if (
    !provided ||
    !expected ||
    provided.length !== expected.length
  ) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < expected.length; i++) {
    diff |=
      provided.charCodeAt(i) ^
      expected.charCodeAt(i);
  }

  return diff === 0;
}

// ========================================
// CHECK PRIVATE BUCKETS
// ========================================

async function assertPrivateBuckets(
  store: ReturnType<typeof storage>
) {
  for (
    const bucket of [
      ...SOURCE_BUCKETS,
      BACKUP_BUCKET
    ]
  ) {
    const { data, error } =
      await store.getBucket(bucket);

    if (error || !data) {
      throw new Failure(
        503,
        `Storage bucket ${bucket} was not found.`
      );
    }

    if (data.public) {
      throw new Failure(
        409,
        `Storage bucket ${bucket} must be PRIVATE.`
      );
    }
  }
}

// ========================================
// LIST STORAGE FILES
// ========================================

async function listBucket(
  store: ReturnType<typeof storage>,
  bucket: string
): Promise<string[]> {
  const paths: string[] = [];
  const folders = [''];
  const visited = new Set<string>();

  while (folders.length) {
    const folder = folders.shift()!;

    if (visited.has(folder)) {
      continue;
    }

    visited.add(folder);

    for (
      let offset = 0;
      ;
      offset += 100
    ) {
      const { data, error } =
        await store.from(bucket).list(
          folder,
          {
            limit: 100,
            offset,
            sortBy: {
              column: 'name',
              order: 'asc'
            }
          }
        );

      if (error) {
        throw new Failure(
          503,
          `Cannot list ${bucket} files.`
        );
      }

      const batch = data ?? [];

      for (const entry of batch) {
        const path = folder
          ? `${folder}/${entry.name}`
          : entry.name;

        if (entry.id) {
          paths.push(path);
        } else {
          folders.push(path);
        }

        if (
          paths.length +
          folders.length +
          visited.size > MAX_LISTING
        ) {
          throw new Failure(
            413,
            'Storage inventory too large for Edge Function.'
          );
        }
      }

      if (batch.length < 100) {
        break;
      }
    }
  }

  return paths;
}

// ========================================
// SHA-256 CHECKSUM
// ========================================

async function sha256(
  bytes: Uint8Array
): Promise<string> {
  const buffer = new ArrayBuffer(
    bytes.byteLength
  );

  new Uint8Array(buffer).set(bytes);

  const digest = await crypto.subtle.digest(
    'SHA-256',
    buffer
  );

  return [
    ...new Uint8Array(digest)
  ]
    .map(n => n.toString(16).padStart(2, '0'))
    .join('');
}

// ========================================
// READ JSON REQUEST
// ========================================

async function readSmallBody(
  request: Request
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();

  if (!reader) {
    throw new Failure(
      400,
      'Request body is required.'
    );
  }

  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } =
        await reader.read();

      if (done) {
        break;
      }

      length += value.byteLength;

      if (length > 2048) {
        await reader.cancel();

        throw new Failure(
          413,
          'Request body too large.'
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  let body: unknown;

  try {
    body = JSON.parse(
      new TextDecoder().decode(bytes)
    );
  } catch {
    throw new Failure(
      400,
      'Invalid JSON request.'
    );
  }

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new Failure(
      400,
      'Invalid request.'
    );
  }

  return body as Record<string, unknown>;
}

// ========================================
// PHOTO SNAPSHOT MANIFEST
// ========================================

function manifestPath(
  id: string
) {
  return `photo-snapshots/${id}/manifest.json`;
}

async function readManifest(
  store: ReturnType<typeof storage>,
  id: string
): Promise<Manifest> {
  if (!SNAPSHOT_RE.test(id)) {
    throw new Failure(
      400,
      'Invalid snapshot identifier.'
    );
  }

  const { data, error } =
    await store.from(BACKUP_BUCKET)
      .download(manifestPath(id));

  if (error || !data) {
    throw new Failure(
      404,
      'Completed photo backup was not found.'
    );
  }

  let manifest: Manifest;

  try {
    manifest = JSON.parse(
      await data.text()
    );
  } catch {
    throw new Failure(
      409,
      'Invalid backup manifest.'
    );
  }

  if (
    manifest.version !== 1 ||
    manifest.id !== id ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > MAX_FILES
  ) {
    throw new Failure(
      409,
      'Backup manifest failed validation.'
    );
  }

  for (const file of manifest.files) {
    if (
      !SOURCE_BUCKETS.includes(
        file.bucket as typeof SOURCE_BUCKETS[number]
      ) ||
      !file.path ||
      file.path.includes('..') ||
      file.path.includes('\\') ||
      file.path.includes('\0') ||
      file.path.startsWith('/') ||
      file.backupPath !==
        `photo-snapshots/${id}/objects/${file.bucket}/${file.path}` ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    ) {
      throw new Failure(
        409,
        'Backup manifest contains an invalid file path or checksum.'
      );
    }
  }

  return manifest;
}

// ========================================
// PHOTO BACKUP HISTORY
// ========================================

async function photoOverview(
  store: ReturnType<typeof storage>
) {
  const { data, error } =
    await store.from(BACKUP_BUCKET)
      .list(
        'photo-snapshots',
        {
          limit: 100
        }
      );

  if (error) {
    throw new Failure(
      503,
      'Cannot retrieve photo backup history.'
    );
  }

  const snapshots: {
    id: string;
    createdAt: string;
    fileCount: number;
    totalBytes: number;
  }[] = [];

  for (const item of data ?? []) {
    if (!SNAPSHOT_RE.test(item.name)) {
      continue;
    }

    try {
      const manifest =
        await readManifest(store, item.name);

      snapshots.push({
        id: manifest.id,
        createdAt: manifest.createdAt,
        fileCount: manifest.files.length,
        totalBytes: manifest.totalBytes
      });
    } catch {
      // Incomplete snapshots are not displayed.
    }
  }

  return snapshots
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt)
    )
    .slice(0, 30);
}

// ========================================
// FIRESTORE BACKUP STATUS
// ========================================

// No paid Google Cloud managed backup is used.

async function firestoreOverview() {
  return {
    schedules: [],
    backups: [],
    error: ''
  };
}

// ========================================
// AUDIT LOG
// ========================================

async function audit(
  actor: {
    uid: string;
    name: string;
  } | null,
  action: string,
  details: string
) {
  await firestore()
    .collection('audit_logs')
    .add({
      user_id: actor?.uid || 'scheduler',
      user_name: actor?.name || 'Scheduled Backup',
      user_role: actor ? 'admin' : 'system',
      category: 'Backup',
      action,
      entity_type: 'backup',
      entity_id: 'photo-snapshots',
      details,
      created_at: FieldValue.serverTimestamp()
    });
}

// ========================================
// CREATE PHOTO BACKUP
// ========================================

async function createPhotoBackup(
  store: ReturnType<typeof storage>,
  actor: {
    uid: string;
    name: string;
  } | null
) {
  await assertPrivateBuckets(store);

  const inventories = await Promise.all(
    SOURCE_BUCKETS.map(async bucket => ({
      bucket,
      paths: await listBucket(store, bucket)
    }))
  );

  const total = inventories.reduce(
    (count, inventory) =>
      count + inventory.paths.length,
    0
  );

  if (total > MAX_FILES) {
    throw new Failure(
      413,
      `There are ${total} photo files. Maximum supported is ${MAX_FILES}.`
    );
  }

  const id = crypto.randomUUID();
  const files: FileEntry[] = [];
  let totalBytes = 0;

  for (const { bucket, paths } of inventories) {
    for (const path of paths) {
      const { data, error } =
        await store.from(bucket)
          .download(path);

      if (error || !data) {
        throw new Failure(
          503,
          `Unable to back up a file from ${bucket}.`
        );
      }

      const bytes = new Uint8Array(
        await data.arrayBuffer()
      );

      totalBytes += bytes.length;

      if (totalBytes > MAX_BYTES) {
        throw new Failure(
          413,
          'Photo backup exceeds 250 MB limit.'
        );
      }

      const backupPath =
        `photo-snapshots/${id}/objects/${bucket}/${path}`;

      const contentType =
        data.type || 'application/octet-stream';

      const { error: putError } =
        await store.from(BACKUP_BUCKET)
          .upload(
            backupPath,
            bytes,
            {
              contentType,
              cacheControl: '0',
              upsert: false
            }
          );

      if (putError) {
        throw new Failure(
          503,
          'Photo backup interrupted. An incomplete snapshot was not published.'
        );
      }

      files.push({
        bucket,
        path,
        backupPath,
        bytes: bytes.length,
        sha256: await sha256(bytes),
        contentType
      });
    }
  }

  const manifest: Manifest = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    files,
    totalBytes
  };

  const { error: manifestError } =
    await store.from(BACKUP_BUCKET)
      .upload(
        manifestPath(id),
        new Blob(
          [JSON.stringify(manifest)],
          {
            type: 'application/json'
          }
        ),
        {
          contentType: 'application/json',
          upsert: false,
          cacheControl: '0'
        }
      );

  if (manifestError) {
    throw new Failure(
      503,
      'Could not finalize photo backup.'
    );
  }

  try {
    await audit(
      actor,
      'Photo backup completed',
      `Snapshot ${id}: ${files.length} files.`
    );
  } catch {
    // Completed backup remains valid.
  }

  return {
    id,
    createdAt: manifest.createdAt,
    fileCount: files.length,
    totalBytes
  };
}

// ========================================
// CHECK MISSING PHOTOS
// ========================================

async function missingPhotos(
  store: ReturnType<typeof storage>,
  manifest: Manifest
) {
  const current = new Map<
    string,
    Set<string>
  >();

  for (const bucket of SOURCE_BUCKETS) {
    current.set(
      bucket,
      new Set(
        await listBucket(store, bucket)
      )
    );
  }

  return manifest.files.filter(
    file =>
      !current.get(file.bucket)?.has(
        file.path
      )
  );
}

// ========================================
// RESTORE MISSING PHOTOS
// ========================================

async function recoverMissing(
  store: ReturnType<typeof storage>,
  manifest: Manifest,
  actor: {
    uid: string;
    name: string;
  }
) {
  const missing =
    await missingPhotos(store, manifest);

  if (missing.length > MAX_RESTORE_FILES) {
    throw new Failure(
      413,
      'Too many missing photos for recovery.'
    );
  }

  let restored = 0;
  const skipped: string[] = [];

  for (const entry of missing) {
    const { data, error } =
      await store.from(BACKUP_BUCKET)
        .download(entry.backupPath);

    if (error || !data) {
      throw new Failure(
        409,
        'Backup object is missing; recovery stopped.'
      );
    }

    const bytes = new Uint8Array(
      await data.arrayBuffer()
    );

    if (
      bytes.length !== entry.bytes ||
      await sha256(bytes) !== entry.sha256
    ) {
      throw new Failure(
        409,
        'Backup checksum mismatch; recovery stopped.'
      );
    }

    const { error: uploadError } =
      await store.from(entry.bucket)
        .upload(
          entry.path,
          bytes,
          {
            contentType: entry.contentType,
            cacheControl: '0',
            upsert: false
          }
        );

    if (uploadError) {
      const status = String(
        (
          uploadError as {
            statusCode?: string | number;
          }
        ).statusCode ?? ''
      );

      if (
        status === '409' ||
        /already exists|duplicate/i.test(
          uploadError.message
        )
      ) {
        skipped.push(
          `${entry.bucket}/${entry.path}`
        );
      } else {
        throw new Failure(
          503,
          'Unable to restore a backup photo; recovery stopped.'
        );
      }
    } else {
      restored++;
    }
  }

  await audit(
    actor,
    'Missing photos recovered',
    `Snapshot ${manifest.id}: restored ${restored}; skipped ${skipped.length}.`
  );

  return {
    restored,
    skippedCount: skipped.length
  };
}

// ========================================
// PHOTO ZIP DOWNLOAD
// ========================================

async function downloadPhotoZip(
  store: ReturnType<typeof storage>,
  manifest: Manifest,
  actor: {
    uid: string;
    name: string;
  },
  responseHeaders: Headers
): Promise<Response> {
  if (
    manifest.totalBytes > MAX_DOWNLOAD_BYTES
  ) {
    throw new Failure(
      413,
      'Photo backup is larger than the 32 MB download limit.'
    );
  }

  const contents: Record<
    string,
    Uint8Array
  > = {
    'snapshot-manifest.json': strToU8(
      JSON.stringify(manifest, null, 2)
    )
  };

  const seenPaths = new Set<string>();
  let bytesTotal = 0;

  for (const entry of manifest.files) {
    const filename =
      `${entry.bucket}/${entry.path}`;

    if (
      seenPaths.has(filename) ||
      !entry.path ||
      entry.path.includes('\\') ||
      entry.path.includes('\0')
    ) {
      throw new Failure(
        409,
        'Invalid or duplicate photo path in snapshot.'
      );
    }

    seenPaths.add(filename);

    const { data, error } =
      await store.from(BACKUP_BUCKET)
        .download(entry.backupPath);

    if (error || !data) {
      throw new Failure(
        409,
        'A backup photo is missing.'
      );
    }

    const bytes = new Uint8Array(
      await data.arrayBuffer()
    );

    bytesTotal += bytes.length;

    if (
      bytes.length !== entry.bytes ||
      bytesTotal > MAX_DOWNLOAD_BYTES ||
      await sha256(bytes) !== entry.sha256
    ) {
      throw new Failure(
        409,
        'Backup photo integrity check failed.'
      );
    }

    contents[filename] = bytes;
  }

  const archive = zipSync(
    contents,
    {
      level: 0
    }
  );

  try {
    await audit(
      actor,
      'Photo backup downloaded',
      `Snapshot ${manifest.id}: ${manifest.files.length} photos.`
    );
  } catch (error) {
    console.error(
      'Backup download audit unavailable',
      error
    );
  }

  const headers =
    new Headers(responseHeaders);

  headers.set(
    'Content-Type',
    'application/zip'
  );

  headers.set(
    'Content-Disposition',
    `attachment; filename="RBCCMS_Photos_${manifest.id}.zip"`
  );

  headers.set(
    'Content-Length',
    String(archive.byteLength)
  );

  const body = new ArrayBuffer(
    archive.byteLength
  );

  new Uint8Array(body).set(archive);

  return new Response(
    body,
    {
      status: 200,
      headers
    }
  );
}

// ========================================
// DEBUG HELPER
// ========================================

async function debugStep<T>(
  label: string,
  task: () => Promise<T>
): Promise<T> {
  const start = Date.now();

  console.log(
    `[BACKUP DEBUG] Starting: ${label}`
  );

  try {
    const value = await task();

    console.log(
      `[BACKUP DEBUG] Success: ${label} (${Date.now() - start}ms)`
    );

    return value;
  } catch (error) {
    console.error(
      `[BACKUP DEBUG] Failed: ${label}:`,
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    throw error;
  }
}

// ========================================
// FULL BACKUP PATHS
// ========================================

function fullDatabasePath(
  id: string
): string {
  if (!SNAPSHOT_RE.test(id)) {
    throw new Failure(
      400,
      'Invalid full backup ID.'
    );
  }

  return `full-backups/${id}/firestore.json`;
}

function fullManifestPath(
  id: string
): string {
  if (!SNAPSHOT_RE.test(id)) {
    throw new Failure(
      400,
      'Invalid full backup ID.'
    );
  }

  return `full-backups/${id}/manifest.json`;
}

// ========================================
// PRESERVE FIRESTORE DATA TYPES
// ========================================

function encodeFirestoreValue(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 30) {
    throw new Failure(
      413,
      'Firestore value nesting too deep for demo export.'
    );
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return {
        __firestoreType: 'nan'
      };
    }

    if (value === Infinity) {
      return {
        __firestoreType: 'positiveInfinity'
      };
    }

    if (value === -Infinity) {
      return {
        __firestoreType: 'negativeInfinity'
      };
    }

    return value;
  }

  if (typeof value === 'bigint') {
    return {
      __firestoreType: 'bigint',
      value: value.toString()
    };
  }

  if (value instanceof Timestamp) {
    return {
      __firestoreType: 'timestamp',
      seconds: value.seconds,
      nanoseconds: value.nanoseconds
    };
  }

  if (value instanceof GeoPoint) {
    return {
      __firestoreType: 'geoPoint',
      latitude: value.latitude,
      longitude: value.longitude
    };
  }

  if (value instanceof DocumentReference) {
    return {
      __firestoreType: 'reference',
      path: value.path
    };
  }

  if (value instanceof Date) {
    return {
      __firestoreType: 'date',
      iso: value.toISOString()
    };
  }

  if (value instanceof Uint8Array) {
    let binary = '';

    for (
      let i = 0;
      i < value.byteLength;
      i += 8192
    ) {
      binary += String.fromCharCode(
        ...value.subarray(i, i + 8192)
      );
    }

    return {
      __firestoreType: 'bytes',
      base64: btoa(binary)
    };
  }

  if (Array.isArray(value)) {
    return value.map(
      item => encodeFirestoreValue(
        item,
        depth + 1
      )
    );
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    if (
      value.constructor?.name === 'VectorValue' &&
      typeof (
        value as {
          toArray?: unknown;
        }
      ).toArray === 'function'
    ) {
      const numbers = (
        value as {
          toArray: () => number[];
        }
      ).toArray();

      return {
        __firestoreType: 'vector',
        values: numbers
      };
    }

    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      result[key] =
        encodeFirestoreValue(
          item,
          depth + 1
        );
    }

    return result;
  }

  throw new Failure(
    409,
    'Unsupported Firestore field type; backup stopped.'
  );
}

// ========================================
// FIRESTORE JSON EXPORT
// ========================================

type DbExport = {
  format: 'RBCCMS-firestore-json-v1';
  projectId: string;
  createdAt: string;
  documentCount: number;
  collectionCount: number;
  documents: {
    path: string;
    fields: unknown;
  }[];
};

async function exportFirestoreDemo(): Promise<{
  bytes: Uint8Array;
  documentCount: number;
  collectionCount: number;
}> {
  const db = firestore();

  const roots =
    await db.listCollections();

  const queue = [...roots];
  const visited = new Set<string>();

  const documents: DbExport['documents'] = [];

  while (queue.length) {
    if (
      queue.length + visited.size >
      MAX_DB_COLLECTIONS
    ) {
      throw new Failure(
        413,
        'Too many Firestore collections for this demo backup.'
      );
    }

    const collection = queue.shift()!;

    if (visited.has(collection.path)) {
      continue;
    }

    visited.add(collection.path);

    if (visited.size > MAX_DB_COLLECTIONS) {
      throw new Failure(
        413,
        'Too many Firestore collections for this demo backup.'
      );
    }

    if (
      collection.path.split('/').length >
      MAX_DB_DEPTH * 2 - 1
    ) {
      throw new Failure(
        413,
        'Firestore subcollection nesting exceeds demo limit.'
      );
    }

    const remaining =
      MAX_DB_DOCUMENTS - documents.length;

    const batch = await collection
      .limit(remaining + 1)
      .get();

    if (batch.size > remaining) {
      throw new Failure(
        413,
        `Firestore has more than ${MAX_DB_DOCUMENTS} documents. Full backup was not created.`
      );
    }

    for (
      let i = 0;
      i < batch.docs.length;
      i += 10
    ) {
      const group = batch.docs.slice(
        i,
        i + 10
      );

      const childLists = await Promise.all(
        group.map(
          doc => doc.ref.listCollections()
        )
      );

      for (
        let j = 0;
        j < group.length;
        j++
      ) {
        const doc = group[j];

        documents.push({
          path: doc.ref.path,
          fields: encodeFirestoreValue(
            doc.data()
          )
        });

        queue.push(...childLists[j]);
      }
    }
  }

  const database: DbExport = {
    format: 'RBCCMS-firestore-json-v1',
    projectId: PROJECT,
    createdAt: new Date().toISOString(),
    documentCount: documents.length,
    collectionCount: visited.size,
    documents
  };

  const bytes = strToU8(
    JSON.stringify(database)
  );

  if (
    bytes.byteLength >
    MAX_DB_EXPORT_BYTES
  ) {
    throw new Failure(
      413,
      'Firestore JSON is over 8 MB; demo Full Backup not created.'
    );
  }

  return {
    bytes,
    documentCount: documents.length,
    collectionCount: visited.size
  };
}

// ========================================
// READ FULL BACKUP MANIFEST
// ========================================

async function readFullRun(
  store: ReturnType<typeof storage>,
  id: string
): Promise<FullBackupRun> {
  const { data, error } =
    await store.from(BACKUP_BUCKET)
      .download(fullManifestPath(id));

  if (error || !data) {
    throw new Failure(
      404,
      'Completed Full Backup not found.'
    );
  }

  let run: FullBackupRun;

  try {
    run = JSON.parse(
      await data.text()
    ) as FullBackupRun;
  } catch {
    throw new Failure(
      409,
      'Full Backup manifest is corrupted.'
    );
  }

  if (
    run.version !== 2 ||
    run.id !== id ||
    run.status !== 'COMPLETED' ||
    run.firestore?.state !== 'COMPLETED' ||
    run.photos?.state !== 'COMPLETED' ||
    run.firestore.backupPath !== fullDatabasePath(id) ||
    !/^[a-f0-9]{64}$/.test(
      run.firestore.sha256
    ) ||
    !SNAPSHOT_RE.test(
      run.photos.snapshotId
    ) ||
    !Number.isSafeInteger(
      run.firestore.totalBytes
    ) ||
    run.firestore.totalBytes < 0 ||
    run.firestore.totalBytes > MAX_DB_EXPORT_BYTES ||
    !Number.isSafeInteger(
      run.photos.totalBytes
    ) ||
    run.photos.totalBytes < 0 ||
    !Number.isSafeInteger(
      run.firestore.documentCount
    ) ||
    !Number.isSafeInteger(
      run.photos.fileCount
    )
  ) {
    throw new Failure(
      409,
      'Invalid Full Backup manifest.'
    );
  }

  return run;
}

// ========================================
// FULL BACKUP HISTORY
// ========================================

async function listFullRuns(
  store: ReturnType<typeof storage>
): Promise<FullBackupRun[]> {
  const { data, error } =
    await store.from(BACKUP_BUCKET)
      .list(
        'full-backups',
        {
          limit: 100,
          sortBy: {
            column: 'name',
            order: 'desc'
          }
        }
      );

  if (error) {
    throw new Failure(
      503,
      'Cannot list Full Backups.'
    );
  }

  const ids = (data ?? [])
    .map(item => item.name)
    .filter(id => SNAPSHOT_RE.test(id));

  const runs: FullBackupRun[] = [];

  for (const id of ids.slice(0, 30)) {
    try {
      runs.push(
        await readFullRun(store, id)
      );
    } catch {
      // Incomplete backups are hidden.
    }
  }

  return runs.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt)
  );
}

// ========================================
// CREATE MANUAL FULL BACKUP
// ========================================

async function createFullBackup(
  store: ReturnType<typeof storage>,
  actor: {
    uid: string;
    name: string;
  }
): Promise<FullBackupRun> {
  await assertPrivateBuckets(store);

  const database =
    await exportFirestoreDemo();

  const id = crypto.randomUUID();
  const databasePath =
    fullDatabasePath(id);

  const databaseHash =
    await sha256(database.bytes);

  const { error: putError } =
    await store.from(BACKUP_BUCKET)
      .upload(
        databasePath,
        database.bytes,
        {
          contentType: 'application/json',
          upsert: false,
          cacheControl: '0'
        }
      );

  if (putError) {
    throw new Failure(
      503,
      'Failed to save Firestore JSON to private backup storage.'
    );
  }

  // Preserve existing photo recovery snapshots.
  const photo = await createPhotoBackup(
    store,
    actor
  );

  if (
    database.bytes.byteLength +
    photo.totalBytes +
    131072 >
    MAX_DOWNLOAD_BYTES
  ) {
    throw new Failure(
      413,
      'Full Backup is too large for a 32 MB ZIP.'
    );
  }

  const run: FullBackupRun = {
    version: 2,
    id,
    createdAt: new Date().toISOString(),
    status: 'COMPLETED',

    firestore: {
      state: 'COMPLETED',
      documentCount: database.documentCount,
      collectionCount: database.collectionCount,
      totalBytes: database.bytes.byteLength,
      sha256: databaseHash,
      backupPath: databasePath
    },

    photos: {
      state: 'COMPLETED',
      snapshotId: photo.id,
      fileCount: photo.fileCount,
      totalBytes: photo.totalBytes
    }
  };

  // Save manifest last to avoid showing
  // incomplete backups as completed.
  const { error: finishError } =
    await store.from(BACKUP_BUCKET)
      .upload(
        fullManifestPath(id),
        strToU8(
          JSON.stringify(run)
        ),
        {
          contentType: 'application/json',
          upsert: false,
          cacheControl: '0'
        }
      );

  if (finishError) {
    throw new Failure(
      503,
      'Unable to finalize Full Backup manifest.'
    );
  }

  try {
    await audit(
      actor,
      'Full backup completed',
      `Run ${id}: ${database.documentCount} Firestore docs and ${photo.fileCount} photos.`
    );
  } catch {
    // Backup remains completed if audit fails.
  }

  return run;
}

// ========================================
// DOWNLOAD FULL ZIP
// ========================================

async function downloadFullZip(
  store: ReturnType<typeof storage>,
  run: FullBackupRun,
  actor: {
    uid: string;
    name: string;
  },
  responseHeaders: Headers
): Promise<Response> {
  const photoManifest =
    await readManifest(
      store,
      run.photos.snapshotId
    );

  if (
    photoManifest.files.length !==
      run.photos.fileCount ||
    photoManifest.totalBytes !==
      run.photos.totalBytes
  ) {
    throw new Failure(
      409,
      'Photo snapshot differs from Full Backup manifest.'
    );
  }

  if (
    run.firestore.totalBytes +
    run.photos.totalBytes >
    MAX_DOWNLOAD_BYTES
  ) {
    throw new Failure(
      413,
      'Full Backup exceeds the 32 MB ZIP limit.'
    );
  }

  const {
    data: blob,
    error: readError
  } = await store.from(BACKUP_BUCKET)
    .download(
      run.firestore.backupPath
    );

  if (readError || !blob) {
    throw new Failure(
      409,
      'Firestore export file is missing.'
    );
  }

  const dbBytes = new Uint8Array(
    await blob.arrayBuffer()
  );

  if (
    dbBytes.byteLength !==
      run.firestore.totalBytes ||
    await sha256(dbBytes) !==
      run.firestore.sha256
  ) {
    throw new Failure(
      409,
      'Firestore export checksum mismatch.'
    );
  }

  const contents: Record<
    string,
    Uint8Array
  > = {
    'database/firestore.json': dbBytes,

    'backup-manifest.json': strToU8(
      JSON.stringify(run, null, 2)
    ),

    'photo-snapshot-manifest.json': strToU8(
      JSON.stringify(photoManifest, null, 2)
    )
  };

  let usedBytes = dbBytes.byteLength;
  const seen = new Set<string>();

  for (const file of photoManifest.files) {
    const filename =
      `${file.bucket}/${file.path}`;

    if (seen.has(filename)) {
      throw new Failure(
        409,
        'Duplicate ZIP entry in photo snapshot.'
      );
    }

    seen.add(filename);

    const { data, error } =
      await store.from(BACKUP_BUCKET)
        .download(file.backupPath);

    if (error || !data) {
      throw new Failure(
        409,
        'A photo backup object is missing.'
      );
    }

    const bytes = new Uint8Array(
      await data.arrayBuffer()
    );

    usedBytes += bytes.byteLength;

    if (
      usedBytes > MAX_DOWNLOAD_BYTES ||
      bytes.byteLength !== file.bytes ||
      await sha256(bytes) !== file.sha256
    ) {
      throw new Failure(
        409,
        'Photo checksum mismatch or combined ZIP too large.'
      );
    }

    contents[filename] = bytes;
  }

  const archive = zipSync(
    contents,
    {
      level: 0
    }
  );

  if (
    archive.byteLength >
    MAX_DOWNLOAD_BYTES
  ) {
    throw new Failure(
      413,
      'Final ZIP exceeds 32 MB.'
    );
  }

  try {
    await audit(
      actor,
      'Full backup downloaded',
      `Run ${run.id} downloaded.`
    );
  } catch {
    // Continue downloading if audit fails.
  }

  const headers =
    new Headers(responseHeaders);

  headers.set(
    'Content-Type',
    'application/zip'
  );

  headers.set(
    'Content-Disposition',
    `attachment; filename="RBCCMS_Full_Backup_${run.id}.zip"`
  );

  headers.set(
    'Content-Length',
    String(archive.byteLength)
  );

  const body = new ArrayBuffer(
    archive.byteLength
  );

  new Uint8Array(body).set(archive);

  return new Response(
    body,
    {
      status: 200,
      headers
    }
  );
}

// ========================================
// MAIN EDGE FUNCTION
// ========================================

Deno.serve(async request => {
  const origin =
    request.headers.get('origin');

  const headers = new Headers({
    'Access-Control-Allow-Methods':
      'POST, OPTIONS',

    'Access-Control-Allow-Headers':
      'authorization, content-type, apikey, x-client-info, x-backup-secret',

    'Cache-Control':
      'no-store',

    'X-Content-Type-Options':
      'nosniff',

    Vary: 'Origin',

    'Content-Type':
      'application/json'
  });

  if (
    origin &&
    ORIGINS.has(origin)
  ) {
    headers.set(
      'Access-Control-Allow-Origin',
      origin
    );
  }

  const json = (
    value: unknown,
    status = 200
  ) => new Response(
    JSON.stringify(value),
    {
      status,
      headers
    }
  );

  try {
    if (
      origin &&
      !ORIGINS.has(origin)
    ) {
      throw new Failure(
        403,
        'Origin not allowed.'
      );
    }

    if (
      request.method === 'OPTIONS'
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers
        }
      );
    }

    if (
      request.method !== 'POST'
    ) {
      throw new Failure(
        405,
        'Use POST.'
      );
    }

    if (
      !request.headers
        .get('content-type')
        ?.includes('application/json')
    ) {
      throw new Failure(
        415,
        'Use JSON.'
      );
    }

    const body = await debugStep(
      'Parse request',
      () => readSmallBody(request)
    );

    const action = body.action as Action;

    if (
      ![
        'overview',
        'photo-backup',
        'photo-preview',
        'photo-recover-missing',
        'photo-download',
        'scheduled-photo-backup',
        'full-backup',
        'full-download'
      ].includes(action)
    ) {
      throw new Failure(
        400,
        'Unknown operation.'
      );
    }

    const allowedKeys = (
      action === 'photo-preview' ||
      action === 'photo-download'
    )
      ? ['action', 'snapshotId']
      : action === 'full-download'
        ? ['action', 'backupId']
        : action === 'photo-recover-missing'
          ? ['action', 'snapshotId', 'confirmation']
          : ['action'];

    if (
      Object.keys(body).length !==
        allowedKeys.length ||
      Object.keys(body).some(
        key => !allowedKeys.includes(key)
      )
    ) {
      throw new Failure(
        400,
        'Unexpected request fields.'
      );
    }

    const scheduled =
      action === 'scheduled-photo-backup';

    let actor: {
      uid: string;
      name: string;
      authTime: number;
    } | null = null;

    if (scheduled) {
      if (origin) {
        throw new Failure(
          403,
          'Scheduled backups cannot originate from a browser.'
        );
      }

      const secret =
        Deno.env.get('BACKUP_CRON_SECRET') || '';

      if (
        secret.length < 32 ||
        !matchesSecret(
          request.headers.get(
            'x-backup-secret'
          ) || '',
          secret
        )
      ) {
        throw new Failure(
          401,
          'Invalid scheduler credentials.'
        );
      }
    } else {
      actor = await debugStep(
        'Verify approved Firebase admin',
        () => adminActor(request)
      );
    }

    const store = storage();

    // ====================================
    // OVERVIEW
    // ====================================

    if (
      action === 'overview'
    ) {
      await debugStep(
        'Verify three private Storage buckets',
        () => assertPrivateBuckets(store)
      );

      const [
        photos,
        fullBackups
      ] = await Promise.all([
        debugStep(
          'Read photo snapshot history',
          () => photoOverview(store)
        ),

        debugStep(
          'Read manual Full Backup history',
          () => listFullRuns(store)
        )
      ]);

      return json({
        firestore:
          await firestoreOverview(),

        photos,
        fullBackups,

        fullBackupConfigured: true
      });
    }

    // ====================================
    // MANUAL FULL BACKUP
    // ====================================

    if (
      action === 'full-backup'
    ) {
      return json({
        backup: await debugStep(
          'Create manual combined backup',
          () => createFullBackup(
            store,
            actor!
          )
        )
      });
    }

    // ====================================
    // DOWNLOAD FULL BACKUP ZIP
    // ====================================

    if (
      action === 'full-download'
    ) {
      const backupId = body.backupId;

      if (
        typeof backupId !== 'string' ||
        !SNAPSHOT_RE.test(backupId)
      ) {
        throw new Failure(
          400,
          'Invalid Full Backup ID.'
        );
      }

      await assertPrivateBuckets(store);

      const run = await readFullRun(
        store,
        backupId
      );

      return await downloadFullZip(
        store,
        run,
        actor!,
        headers
      );
    }

    // ====================================
    // PHOTO-ONLY BACKUP
    // ====================================

    if (
      action === 'photo-backup' ||
      action === 'scheduled-photo-backup'
    ) {
      return json({
        backup: await debugStep(
          'Create photo snapshot',
          () => createPhotoBackup(
            store,
            actor
          )
        )
      });
    }

    // ====================================
    // PHOTO SNAPSHOT ACTIONS
    // ====================================

    const id = body.snapshotId;

    if (
      typeof id !== 'string' ||
      !SNAPSHOT_RE.test(id)
    ) {
      throw new Failure(
        400,
        'Invalid snapshot ID.'
      );
    }

    await debugStep(
      'Verify private Storage buckets',
      () => assertPrivateBuckets(store)
    );

    const manifest = await debugStep(
      'Load snapshot manifest',
      () => readManifest(
        store,
        id
      )
    );

    // ====================================
    // PHOTO ZIP DOWNLOAD
    // ====================================

    if (
      action === 'photo-download'
    ) {
      return await debugStep(
        'Create downloadable photo ZIP',
        () => downloadPhotoZip(
          store,
          manifest,
          actor!,
          headers
        )
      );
    }

    // ====================================
    // PREVIEW PHOTO RECOVERY
    // ====================================

    if (
      action === 'photo-preview'
    ) {
      const missing = await debugStep(
        'Preview missing photo files',
        () => missingPhotos(
          store,
          manifest
        )
      );

      return json({
        snapshotId: id,
        total: manifest.files.length,
        missing: missing.length,
        existing:
          manifest.files.length -
          missing.length
      });
    }

    // ====================================
    // RECOVER MISSING PHOTOS
    // ====================================

    if (
      body.confirmation !==
      'RECOVER MISSING PHOTOS'
    ) {
      throw new Failure(
        400,
        'Confirmation phrase does not match.'
      );
    }

    const authAge =
      Date.now() / 1000 -
      (actor?.authTime ?? 0);

    if (
      !Number.isFinite(authAge) ||
      authAge < -30 ||
      authAge > 300
    ) {
      throw new Failure(
        401,
        'Reauthenticate before recovery.'
      );
    }

    return json(
      await debugStep(
        'Restore missing photo files',
        () => recoverMissing(
          store,
          manifest,
          actor!
        )
      )
    );

  } catch (error) {
    console.error(
      '[BACKUP DEBUG] Request failed:',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    return json(
      {
        error:
          error instanceof Failure
            ? error.message
            : 'Backup service temporarily unavailable.'
      },
      error instanceof Failure
        ? error.status
        : 503
    );
  }
});
