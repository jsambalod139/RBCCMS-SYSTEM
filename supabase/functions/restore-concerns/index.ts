
import {
  cert,
  getApps,
  initializeApp,
} from 'npm:firebase-admin@13/app';

import {
  getAuth,
} from 'npm:firebase-admin@13/auth';

import {
  FieldValue,
  GeoPoint,
  Timestamp,
  initializeFirestore,
} from 'npm:firebase-admin@13/firestore';

import {
  createClient,
} from 'npm:@supabase/supabase-js@2';

import { Buffer } from 'node:buffer';

const PROJECT = 'rbccms-system';
const BACKUP_BUCKET = 'rbccms-backups';

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENTS = 300;
const MAX_RESTORE = 25;

const ID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const ALLOWED_ORIGINS = new Set(
  (
    Deno.env.get('ALLOWED_ORIGINS') ||
    'http://localhost:4200,http://127.0.0.1:4200'
  )
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

type BackupDocument = {
  path: string;
  fields: Record<string, unknown>;
};

type BackupData = {
  format: 'RBCCMS-firestore-json-v1';
  projectId: string;
  documentCount: number;
  documents: BackupDocument[];
};

type BackupManifest = {
  version: 2;
  id: string;
  status: 'COMPLETED';

  firestore: {
    state: 'COMPLETED';
    backupPath: string;
    sha256: string;
    totalBytes: number;
  };
};

class ApiError extends Error {
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

function firebaseApp() {
  if (getApps().length) {
    return getApps()[0];
  }

  const json = Deno.env.get(
    'FIREBASE_SERVICE_ACCOUNT'
  );

  if (!json) {
    throw new ApiError(
      503,
      'Firebase service credentials are missing.'
    );
  }

  let account: {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };

  try {
    account = JSON.parse(json);
  } catch {
    throw new ApiError(
      503,
      'Firebase credentials are invalid.'
    );
  }

  if (
    account.project_id !== PROJECT ||
    !account.client_email ||
    !account.private_key
  ) {
    throw new ApiError(
      503,
      'Wrong Firebase service account.'
    );
  }

  return initializeApp({
    projectId: PROJECT,
    credential: cert({
      projectId: PROJECT,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    }),
  });
}

// ========================================
// FIRESTORE DATABASE
// ========================================

let database:
  | ReturnType<typeof initializeFirestore>
  | undefined;

function db() {
  if (!database) {
    database = initializeFirestore(
      firebaseApp(),
      { preferRest: true }
    );
  }

  return database;
}

// ========================================
// SUPABASE STORAGE
// ========================================

function store() {
  const url = Deno.env.get('SUPABASE_URL');

  const direct = Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY'
  );

  let key = direct;

  const map = Deno.env.get(
    'SUPABASE_SECRET_KEYS'
  );

  if (map) {
    try {
      key = JSON.parse(map).default || key;
    } catch {
      throw new ApiError(
        503,
        'Supabase storage key setting is invalid.'
      );
    }
  }

  if (!url || !key) {
    throw new ApiError(
      503,
      'Supabase storage credentials are missing.'
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }).storage;
}

// ========================================
// ADMIN ACCESS VERIFICATION
// ========================================

async function approvedAdmin(
  request: Request
) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer (\S+)$/i)?.[1];

  if (!token) {
    throw new ApiError(
      401,
      'Admin sign-in required.'
    );
  }

  let decoded;

  try {
    decoded = await getAuth(firebaseApp())
      .verifyIdToken(token, true);
  } catch {
    throw new ApiError(
      401,
      'Login session expired. Please sign in again.'
    );
  }

  const account = await db()
    .doc(`users/${decoded.uid}`)
    .get();

  if (
    account.data()?.role !== 'admin' ||
    account.data()?.accountStatus !== 'approved'
  ) {
    throw new ApiError(
      403,
      'Only approved Admin accounts can restore records.'
    );
  }

  return {
    uid: decoded.uid,
    authTime: decoded.auth_time,
  };
}

// ========================================
// BACKUP CHECKSUM
// ========================================

async function digest(
  bytes: Uint8Array
): Promise<string> {
  const copy = new ArrayBuffer(
    bytes.byteLength
  );

  new Uint8Array(copy).set(bytes);

  const result = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      copy
    )
  );

  return [...result]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ========================================
// READ SAVED FULL BACKUP
// ========================================

async function downloadSnapshot(
  backupId: string
): Promise<BackupData> {
  if (!ID_RE.test(backupId)) {
    throw new ApiError(
      400,
      'Invalid Full Backup ID.'
    );
  }

  const supa = store();

  const bucket = await supa.getBucket(
    BACKUP_BUCKET
  );

  if (
    bucket.error ||
    !bucket.data ||
    bucket.data.public
  ) {
    throw new ApiError(
      503,
      'The backup bucket must exist and be private.'
    );
  }

  const manifestPath =
    `full-backups/${backupId}/manifest.json`;

  const manifestFile = await supa
    .from(BACKUP_BUCKET)
    .download(manifestPath);

  if (
    manifestFile.error ||
    !manifestFile.data
  ) {
    throw new ApiError(
      404,
      'Completed Full Backup was not found.'
    );
  }

  let manifest: BackupManifest;

  try {
    manifest = JSON.parse(
      await manifestFile.data.text()
    );
  } catch {
    throw new ApiError(
      409,
      'Backup manifest is corrupted.'
    );
  }

  const expectedPath =
    `full-backups/${backupId}/firestore.json`;

  if (
    manifest.version !== 2 ||
    manifest.id !== backupId ||
    manifest.status !== 'COMPLETED' ||
    manifest.firestore?.state !== 'COMPLETED' ||
    manifest.firestore.backupPath !== expectedPath ||
    !/^[0-9a-f]{64}$/.test(
      manifest.firestore.sha256
    ) ||
    !Number.isSafeInteger(
      manifest.firestore.totalBytes
    ) ||
    manifest.firestore.totalBytes > MAX_JSON_BYTES ||
    manifest.firestore.totalBytes < 1
  ) {
    throw new ApiError(
      409,
      'Full Backup manifest failed validation.'
    );
  }

  const file = await supa
    .from(BACKUP_BUCKET)
    .download(expectedPath);

  if (
    file.error ||
    !file.data
  ) {
    throw new ApiError(
      409,
      'Database backup JSON is missing.'
    );
  }

  const bytes = new Uint8Array(
    await file.data.arrayBuffer()
  );

  if (
    bytes.byteLength !==
      manifest.firestore.totalBytes ||
    await digest(bytes) !==
      manifest.firestore.sha256
  ) {
    throw new ApiError(
      409,
      'Database backup checksum does not match.'
    );
  }

  let exportData: BackupData;

  try {
    exportData = JSON.parse(
      new TextDecoder().decode(bytes)
    );
  } catch {
    throw new ApiError(
      409,
      'Database backup JSON is invalid.'
    );
  }

  if (
    exportData.format !==
      'RBCCMS-firestore-json-v1' ||
    exportData.projectId !== PROJECT ||
    !Array.isArray(exportData.documents) ||
    !Number.isSafeInteger(
      exportData.documentCount
    ) ||
    exportData.documentCount !==
      exportData.documents.length ||
    exportData.documents.length > MAX_DOCUMENTS
  ) {
    throw new ApiError(
      409,
      'Database backup content failed validation.'
    );
  }

  const used = new Set<string>();

  for (const entry of exportData.documents) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      !entry.fields ||
      typeof entry.fields !== 'object' ||
      Array.isArray(entry.fields) ||
      used.has(entry.path)
    ) {
      throw new ApiError(
        409,
        'Backup document is invalid or duplicated.'
      );
    }

    used.add(entry.path);
  }

  return exportData;
}

// ========================================
// FILTER CONCERN RECORDS ONLY
// ========================================

function concernDocuments(
  data: BackupData
): BackupDocument[] {
  // Only top-level concern records are restored.
  // Users, roles, offices, and audit logs
  // are never restored by this function.

  return data.documents.filter(
    document =>
      /^concerns\/[^/]{1,150}$/.test(
        document.path
      ) &&
      document.path.split('/')[1] !== '.' &&
      document.path.split('/')[1] !== '..'
  );
}

// ========================================
// RESTORE FIRESTORE DATA TYPES
// ========================================

function decodeValue(
  value: unknown,
  depth = 0
): any {
  if (depth > 30) {
    throw new ApiError(
      409,
      'A backup field is nested too deeply.'
    );
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      item => decodeValue(item, depth + 1)
    );
  }

  if (
    !value ||
    typeof value !== 'object'
  ) {
    throw new ApiError(
      409,
      'Invalid database field.'
    );
  }

  const item = value as Record<string, any>;

  if (
    Object.hasOwn(item, '__firestoreType')
  ) {
    switch (item.__firestoreType) {
      case 'timestamp':
        if (
          !Number.isSafeInteger(item.seconds) ||
          !Number.isInteger(item.nanoseconds) ||
          item.nanoseconds < 0 ||
          item.nanoseconds >= 1e9
        ) {
          throw new ApiError(
            409,
            'Invalid timestamp.'
          );
        }

        return new Timestamp(
          item.seconds,
          item.nanoseconds
        );

      case 'date': {
        if (typeof item.iso !== 'string') {
          throw new ApiError(
            409,
            'Invalid date.'
          );
        }

        const date = new Date(item.iso);

        if (Number.isNaN(date.getTime())) {
          throw new ApiError(
            409,
            'Invalid date.'
          );
        }

        return date;
      }

      case 'geoPoint':
        if (
          typeof item.latitude !== 'number' ||
          typeof item.longitude !== 'number' ||
          item.latitude < -90 ||
          item.latitude > 90 ||
          item.longitude < -180 ||
          item.longitude > 180
        ) {
          throw new ApiError(
            409,
            'Invalid geopoint.'
          );
        }

        return new GeoPoint(
          item.latitude,
          item.longitude
        );

      case 'reference':
        if (
          typeof item.path !== 'string' ||
          item.path.split('/').length % 2 ||
          item.path.includes('..') ||
          item.path.startsWith('/')
        ) {
          throw new ApiError(
            409,
            'Invalid document reference.'
          );
        }

        return db().doc(item.path);

      case 'bytes': {
        if (
          typeof item.base64 !== 'string' ||
          item.base64.length > 1400000 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(
            item.base64
          )
        ) {
          throw new ApiError(
            409,
            'Invalid bytes.'
          );
        }

        return Buffer.from(
          item.base64,
          'base64'
        );
      }

      case 'nan':
        return NaN;

      case 'positiveInfinity':
        return Infinity;

      case 'negativeInfinity':
        return -Infinity;

      default:
        throw new ApiError(
          409,
          'Unsupported Firestore type in concern record. Restore stopped.'
        );
    }
  }

  return Object.fromEntries(
    Object.entries(item).map(
      ([key, field]) => [
        key,
        decodeValue(field, depth + 1),
      ]
    )
  );
}

// ========================================
// PREVIEW MISSING CONCERNS
// ========================================

async function preview(
  backupId: string
) {
  const exported =
    await downloadSnapshot(backupId);

  const docs = concernDocuments(
    exported
  );

  const missing: BackupDocument[] = [];
  let existing = 0;

  for (
    let i = 0;
    i < docs.length;
    i += 20
  ) {
    const batch = docs.slice(
      i,
      i + 20
    );

    const states = await Promise.all(
      batch.map(
        item => db().doc(item.path).get()
      )
    );

    states.forEach((state, index) => {
      if (state.exists) {
        existing++;
      } else {
        missing.push(batch[index]);
      }
    });
  }

  return {
    backupId,
    total: docs.length,
    existing,
    missing: missing.length,
    missingIds: missing
      .slice(0, 10)
      .map(
        item => item.path.split('/')[1]
      ),
    limit: MAX_RESTORE,
  };
}

// ========================================
// RESTORE MISSING CONCERNS
// ========================================

async function restore(
  backupId: string,
  actorId: string
) {
  const data =
    await downloadSnapshot(backupId);

  const docs = concernDocuments(data);
  const absent: BackupDocument[] = [];

  for (
    let i = 0;
    i < docs.length;
    i += 20
  ) {
    const slice = docs.slice(
      i,
      i + 20
    );

    const states = await Promise.all(
      slice.map(
        item => db().doc(item.path).get()
      )
    );

    states.forEach((state, index) => {
      if (!state.exists) {
        absent.push(slice[index]);
      }
    });
  }

  if (absent.length > MAX_RESTORE) {
    throw new ApiError(
      413,
      `More than ${MAX_RESTORE} concern records are missing. Stop and contact the developer.`
    );
  }

  // Validate before writing any documents.
  const prepared = absent.map(item => ({
    path: item.path,
    fields: decodeValue(
      item.fields
    ) as Record<string, unknown>,
  }));

  let restored = 0;
  let skipped = 0;

  for (const item of prepared) {
    try {
      // create() fails when the document exists.
      // Existing concern records are never overwritten.
      await db()
        .doc(item.path)
        .create(item.fields);

      restored++;
    } catch (error) {
      const failure = error as {
        code?: string | number;
        message?: string;
      };

      if (
        failure.code === 6 ||
        failure.code === 'already-exists' ||
        /already exists/i.test(
          failure.message || ''
        )
      ) {
        skipped++;
      } else {
        throw new ApiError(
          503,
          'Restore interrupted; some records may have been created. Preview again before retrying.'
        );
      }
    }
  }

  try {
    await db()
      .collection('audit_logs')
      .add({
        user_id: actorId,
        user_role: 'admin',
        category: 'Backup',
        action: 'Restored missing concerns',
        entity_type: 'backup',
        entity_id: backupId,
        details:
          `${restored} concern records restored, ` +
          `${skipped} skipped; existing records unchanged.`,
        created_at: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error(
      'Recovery audit log failed:',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );
  }

  return {
    restored,
    skipped,
    backupId,
  };
}

// ========================================
// SUPABASE EDGE FUNCTION
// ========================================

Deno.serve(async request => {
  const origin = request.headers.get(
    'origin'
  );

  const headers = new Headers({
    'Access-Control-Allow-Headers':
      'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods':
      'POST, OPTIONS',
    'Content-Type':
      'application/json',
    'Cache-Control':
      'no-store',
    'Vary':
      'Origin',
  });

  if (
    origin &&
    ALLOWED_ORIGINS.has(origin)
  ) {
    headers.set(
      'Access-Control-Allow-Origin',
      origin
    );
  }

  const json = (
    data: unknown,
    status = 200
  ) => new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    }
  );

  try {
    if (
      origin &&
      !ALLOWED_ORIGINS.has(origin)
    ) {
      throw new ApiError(
        403,
        'Origin not permitted.'
      );
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers,
      });
    }

    if (request.method !== 'POST') {
      throw new ApiError(
        405,
        'Only POST is supported.'
      );
    }

    if (
      !request.headers
        .get('content-type')
        ?.includes('application/json')
    ) {
      throw new ApiError(
        415,
        'JSON required.'
      );
    }

    if (
      Number(
        request.headers.get(
          'content-length'
        ) || 0
      ) > 1024
    ) {
      throw new ApiError(
        413,
        'Request too large.'
      );
    }

    const raw = await request.text();

    if (raw.length > 1024) {
      throw new ApiError(
        413,
        'Request too large.'
      );
    }

    let body: {
      action?: string;
      backupId?: string;
      confirmation?: string;
    };

    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(
        400,
        'Invalid JSON body.'
      );
    }

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      throw new ApiError(
        400,
        'Invalid request.'
      );
    }

    if (
      !['preview', 'restore'].includes(
        body.action || ''
      ) ||
      typeof body.backupId !== 'string' ||
      !ID_RE.test(body.backupId)
    ) {
      throw new ApiError(
        400,
        'Invalid recovery action or Full Backup ID.'
      );
    }

    const keys =
      body.action === 'preview'
        ? ['action', 'backupId']
        : [
            'action',
            'backupId',
            'confirmation',
          ];

    if (
      Object.keys(body).length !== keys.length ||
      Object.keys(body).some(
        key => !keys.includes(key)
      )
    ) {
      throw new ApiError(
        400,
        'Unexpected request fields.'
      );
    }

    const actor = await approvedAdmin(
      request
    );

    if (body.action === 'preview') {
      return json(
        await preview(body.backupId)
      );
    }

    if (
      body.confirmation !==
      'RESTORE MISSING CONCERNS'
    ) {
      throw new ApiError(
        400,
        'Confirmation phrase must match exactly.'
      );
    }

    // Only allow recently reauthenticated Admins.
    const age =
      Date.now() / 1000 -
      actor.authTime;

    if (
      !Number.isFinite(age) ||
      age < -30 ||
      age > 300
    ) {
      throw new ApiError(
        401,
        'Reauthenticate as Admin before restoring concerns.'
      );
    }

    return json(
      await restore(
        body.backupId,
        actor.uid
      )
    );
  } catch (error) {
    console.error(
      '[CONCERN RECOVERY]',
      error instanceof Error
        ? error.message
        : 'Unknown error'
    );

    return json(
      {
        error:
          error instanceof ApiError
            ? error.message
            : 'Concern recovery temporarily unavailable.',
      },
      error instanceof ApiError
        ? error.status
        : 503
    );
  }
});
