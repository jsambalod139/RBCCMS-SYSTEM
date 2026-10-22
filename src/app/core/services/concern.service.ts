import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Observable, defer } from 'rxjs';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import {
  DocumentData, Timestamp, Unsubscribe, collection, doc, getDoc,
  getFirestore, onSnapshot, query, runTransaction, serverTimestamp,
  setDoc, where,
} from 'firebase/firestore';
import { deleteObject, getBlob, getStorage, ref, uploadBytes } from 'firebase/storage';
import { firebaseApp } from '../firebase.config';
import {
  ConcernPayload, ConcernResponse, ConcernStatus, ConcernUpdate,
  ConcernWithRelations,
} from '../models/concern.model';
import { ConcernCategoryService } from './concern-category.service';

const STATUSES: ConcernStatus[] = ['Pending', 'In Progress', 'Resolved', 'Rejected'];

@Injectable({ providedIn: 'root' })
export class ConcernService implements OnDestroy {
  private readonly categoryService = inject(ConcernCategoryService);
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);
  private readonly storage = getStorage(firebaseApp);
  private readonly records = signal<ConcernWithRelations[]>([]);
  private readonly busy = signal(true);
  private readonly failure = signal('');
  private readonly photoFailure = signal('');

  readonly concerns = this.records.asReadonly();
  readonly loading = this.busy.asReadonly();
  readonly error = this.failure.asReadonly();
  readonly photoError = this.photoFailure.asReadonly();

  private stopAuth?: Unsubscribe;
  private stopProfile?: Unsubscribe;
  private stopRecords?: Unsubscribe;
  private generation = 0;
  private photoGeneration = 0;
  private profileGeneration = 0;
  private readonly objectUrls = new Map<string, string>();

  constructor() {
    this.stopAuth = onAuthStateChanged(this.auth, () => this.reload());
  }

  // Restart listeners on retry; sign-out/account changes always clear old records.
  reload(): void {
    const generation = ++this.generation;
    this.stopProfile?.();
    this.stopRecords?.();
    this.clearRecords();
    this.failure.set('');
    this.busy.set(true);
    const user = this.auth.currentUser;
    if (!user) {
      this.busy.set(false);
      return;
    }

    this.stopProfile = onSnapshot(doc(this.db, 'users', user.uid), snapshot => {
      if (generation !== this.generation) return;
      const profileGeneration = ++this.profileGeneration;
      this.stopRecords?.();
      this.clearRecords();
      this.failure.set('');
      const profile = snapshot.data();
      if (!profile || profile['accountStatus'] !== 'approved' ||
          !['resident', 'personnel'].includes(profile['role'])) {
        this.busy.set(false);
        this.failure.set('An approved resident or personnel account is required.');
        return;
      }
      this.busy.set(true);
      const field = profile['role'] === 'resident'
        ? 'resident_id' : 'assigned_personnel_id';
      const scopedQuery = query(collection(this.db, 'concerns'), where(field, '==', user.uid));

      this.stopRecords = onSnapshot(scopedQuery, result => {
        if (generation !== this.generation || profileGeneration !== this.profileGeneration) return;
        this.records.set(result.docs.map(item => this.toConcern(item.id, item.data()))
          .sort((a, b) => b.reported_at.localeCompare(a.reported_at)));
        this.busy.set(false);
        this.failure.set('');
        this.loadPhotos(generation);
      }, error => {
        if (generation !== this.generation || profileGeneration !== this.profileGeneration) return;
        this.clearRecords();
        this.busy.set(false);
        this.failure.set(this.errorMessage(error));
      });
    }, error => {
      if (generation !== this.generation) return;
      ++this.profileGeneration;
      this.stopRecords?.();
      this.clearRecords();
      this.busy.set(false);
      this.failure.set(this.errorMessage(error));
    });
  }

  submitConcern(payload: ConcernPayload, photo: File | null): Observable<ConcernResponse> {
    return defer(() => this.createConcern(payload, photo));
  }

  private async createConcern(payload: ConcernPayload, photo: File | null): Promise<ConcernResponse> {
    const user = await this.requireRole('resident');
    const category = this.categoryService.getById(payload.category_id);
    const location = payload.location_description.trim();
    const description = payload.description.trim();
    if (!category || !location || location.length > 255 ||
        !description || description.length > 5000) {
      throw new Error('Provide a valid category, location, and description.');
    }
    if (photo && (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ||
        photo.size <= 0 || photo.size > 5 * 1024 * 1024)) {
      throw new Error('Select a JPG, PNG, or WebP photo no larger than 5 MB.');
    }
    const concernRef = doc(collection(this.db, 'concerns'));
    const photoPath = photo ? `concern-photos/${user.uid}/${concernRef.id}/photo` : null;
    let uploaded = false;
    try {
      if (photo && photoPath) {
        await uploadBytes(ref(this.storage, photoPath), photo, { contentType: photo.type });
        uploaded = true;
      }
      if (this.auth.currentUser?.uid !== user.uid) throw new Error('Your login changed. Sign in again.');
      await setDoc(concernRef, {
        resident_id: user.uid,
        assigned_personnel_id: null,
        category_id: payload.category_id,
        location_description: location,
        description,
        photo_path: photoPath,
        current_status: 'Pending',
        reported_at: serverTimestamp(),
        updated_at: null,
        updates: {},
        revision: 0,
      });
      return { concern_id: concernRef.id, message: 'Concern saved to Firebase.' };
    } catch (error) {
      if (uploaded && photoPath) await deleteObject(ref(this.storage, photoPath)).catch(() => undefined);
      if (photo && !uploaded) {
        throw new Error('Photo upload failed. Check Firebase Storage setup and rules, or remove the photo and retry.');
      }
      throw new Error(this.errorMessage(error));
    }
  }

  async updateStatus(
    concernId: string, newStatus: ConcernStatus, remarks: string
  ): Promise<ConcernWithRelations> {
    const user = await this.requireRole('personnel');
    if (!STATUSES.includes(newStatus) || remarks.length > 2000) {
      throw new Error('Choose a valid status and use at most 2000 characters for remarks.');
    }
    const concernRef = doc(this.db, 'concerns', concernId);
    await runTransaction(this.db, async transaction => {
      const snapshot = await transaction.get(concernRef);
      if (!snapshot.exists()) throw new Error('Concern not found.');
      const data = snapshot.data();
      if (data['assigned_personnel_id'] !== user.uid) throw new Error('This concern is not assigned to you.');
      if (data['current_status'] === newStatus) throw new Error('Select a different status.');
      const revision = Number(data['revision']) + 1;
      transaction.update(concernRef, {
        current_status: newStatus,
        updated_at: serverTimestamp(),
        revision,
        updates: {
          ...data['updates'],
          [String(revision)]: {
            update_id: revision,
            previous_status: data['current_status'],
            new_status: newStatus,
            remarks: remarks.trim() || null,
            created_at: serverTimestamp(),
            updated_by: user.uid,
          },
        },
      });
    });
    const saved = await getDoc(concernRef);
    if (!saved.exists()) throw new Error('Saved concern is unavailable.');
    return this.toConcern(saved.id, saved.data());
  }

  private async requireRole(role: 'resident' | 'personnel') {
    await this.auth.authStateReady();
    const user = this.auth.currentUser;
    if (!user) throw new Error('Please sign in first.');
    const profile = (await getDoc(doc(this.db, 'users', user.uid))).data();
    if (profile?.['role'] !== role || profile?.['accountStatus'] !== 'approved') {
      throw new Error(`An approved ${role} account is required.`);
    }
    return user;
  }

  private iso(value: unknown): string {
    return value instanceof Timestamp ? value.toDate().toISOString() : '';
  }

  private toConcern(id: string, data: DocumentData): ConcernWithRelations {
    const updates = Object.values(data['updates'] ?? {}) as DocumentData[];
    return {
      concern_id: id,
      resident_id: data['resident_id'],
      assigned_personnel_id: data['assigned_personnel_id'],
      category_id: data['category_id'],
      category: this.categoryService.getById(data['category_id']),
      location_description: data['location_description'],
      description: data['description'],
      photo_path: data['photo_path'],
      photo_url: this.objectUrls.get(data['photo_path']) ?? null,
      current_status: data['current_status'],
      reported_at: this.iso(data['reported_at']),
      updated_at: data['updated_at'] ? this.iso(data['updated_at']) : null,
      updates: updates.map((update): ConcernUpdate => ({
        update_id: update['update_id'], previous_status: update['previous_status'],
        new_status: update['new_status'], remarks: update['remarks'],
        created_at: this.iso(update['created_at']), updated_by: update['updated_by'],
      })).sort((a, b) => a.update_id - b.update_id),
    };
  }

  private loadPhotos(generation: number): void {
    const photoGeneration = ++this.photoGeneration;
    this.photoFailure.set('');
    const visiblePaths = new Set(this.records().map(item => item.photo_path).filter(Boolean));
    for (const [path, url] of this.objectUrls) {
      if (!visiblePaths.has(path)) {
        URL.revokeObjectURL(url);
        this.objectUrls.delete(path);
      }
    }
    for (const concern of this.records()) {
      const path = concern.photo_path;
      if (!path || this.objectUrls.has(path)) continue;
      void getBlob(ref(this.storage, path), 5 * 1024 * 1024).then(blob => {
        if (generation !== this.generation || photoGeneration !== this.photoGeneration) return;
        const url = URL.createObjectURL(blob);
        this.objectUrls.set(path, url);
        this.records.update(items => items.map(item => item.photo_path === path ? { ...item, photo_url: url } : item));
      }).catch(() => {
        if (generation === this.generation && photoGeneration === this.photoGeneration) {
          this.photoFailure.set('A photo could not be loaded. Check Storage permissions, connection, and CORS setup.');
        }
      });
    }
  }

  private clearRecords(): void {
    ++this.photoGeneration;
    this.records.set([]);
    this.photoFailure.set('');
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  private errorMessage(error: unknown): string {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code.includes('permission-denied')) return 'Access denied. Check account approval, assignment, and Firestore rules.';
    if (code.includes('unavailable')) return 'Firebase is unavailable. Check your connection and retry.';
    return error instanceof Error ? error.message : 'Unable to access concern records.';
  }

  ngOnDestroy(): void {
    ++this.generation;
    this.stopAuth?.();
    this.stopProfile?.();
    this.stopRecords?.();
    this.clearRecords();
  }
}
