import { Injectable, inject, signal } from '@angular/core';
import { Observable, defer, delay, map } from 'rxjs';
import {
  ConcernPayload,
  ConcernResponse,
  ConcernWithRelations
} from '../models/concern.model';
import { ConcernCategoryService } from './concern-category.service';

const STORAGE_KEY = 'rbccms_resident_concerns';

@Injectable({ providedIn: 'root' })
export class ConcernService {
  private readonly categoryService = inject(ConcernCategoryService);

  private readonly _concerns = signal<ConcernWithRelations[]>(this.load());

  /** Shared, read-only list used by the My Concerns page. */
  readonly concerns = this._concerns.asReadonly();

  /**
   * Creates a concern and adds it to the shared list.
   * Frontend-only for now. To use a real API later, replace the body with
   * an HttpClient POST and update `_concerns` from the response.
   */
  submitConcern(
    payload: ConcernPayload,
    photo: File | null
  ): Observable<ConcernResponse> {
    return defer(() => this.readPhoto(photo)).pipe(
      delay(400), // simulates a network request
      map((photoUrl) => {
        const now = new Date().toISOString();
        const concernId = this.generateId();

        const concern: ConcernWithRelations = {
          concern_id: concernId,
          category_id: payload.category_id,
          category: this.categoryService.getById(payload.category_id),
          location_description: payload.location_description,
          description: payload.description,
          photo_url: photoUrl,
          current_status: 'Pending',
          reported_at: now,
          updated_at: null,
          updates: [
            {
              update_id: 1,
              previous_status: null,
              new_status: 'Pending',
              remarks: 'Concern submitted by resident.',
              created_at: now
            }
          ]
        };

        // Newest first
        this._concerns.update((list) => [concern, ...list]);
        this.save();

        return {
          concern_id: concernId,
          message: 'Concern submitted successfully.'
        };
      })
    );
  }

  private generateId(): string {
    const year = new Date().getFullYear();
    const next = this._concerns().length + 1;
    return `CON-${year}-${String(next).padStart(4, '0')}`;
  }

  private readPhoto(file: File | null): Promise<string | null> {
    if (!file) return Promise.resolve(null);

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  private load(): ConcernWithRelations[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ConcernWithRelations[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      // Photos are not persisted: base64 images would exceed the
      // localStorage quota quickly. They stay available until refresh.
      const slim = this._concerns().map((c) => ({ ...c, photo_url: null }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      // Ignore storage errors (quota, private mode)
    }
  }
}