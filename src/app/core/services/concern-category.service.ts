import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

import {
  Transaction,
  doc,
  getFirestore
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';
import { ConcernCategory } from '../models/concern.model';

@Injectable({ providedIn: 'root' })
export class ConcernCategoryService {
  private readonly db = getFirestore(firebaseApp);

  private readonly categories: ConcernCategory[] = [
    {
      category_id: 1,
      category_name: 'Road and Infrastructure'
    },
    {
      category_id: 2,
      category_name: 'Water Supply'
    },
    {
      category_id: 3,
      category_name: 'Streetlights'
    },
    {
      category_id: 4,
      category_name: 'Waste Management'
    },
    {
      category_id: 5,
      category_name: 'Public Facilities'
    },
    {
      category_id: 6,
      category_name: 'Drainage and Flooding'
    },
    {
      category_id: 7,
      category_name: 'Environmental Concerns'
    },
    {
      category_id: 8,
      category_name: 'Other Community Concerns'
    }
  ];

  getCategories(): Observable<ConcernCategory[]> {
    return of(
      this.categories.map(category => ({ ...category }))
    );
  }

  getById(categoryId: number): ConcernCategory | undefined {
    return this.categories.find(
      category => category.category_id === categoryId
    );
  }

  async getOfficeId(
    categoryId: number,
    transaction: Transaction
  ): Promise<string> {
    if (!this.getById(categoryId)) {
      throw new Error('Select a valid concern category.');
    }

    const categorySnapshot = await transaction.get(
      doc(this.db, 'categories', String(categoryId))
    );

    const category = categorySnapshot.data();
    const officeId = category?.['office_id'];

    if (
      category?.['is_active'] !== true ||
      typeof officeId !== 'string' ||
      !officeId.trim() ||
      officeId.includes('/')
    ) {
      throw new Error(
        'This category has no active responsible office configured. ' +
        'Please contact the barangay.'
      );
    }

    const officeSnapshot = await transaction.get(
      doc(this.db, 'offices', officeId)
    );

    if (!officeSnapshot.exists()) {
      throw new Error(
        'The responsible office is unavailable. ' +
        'Please contact the barangay.'
      );
    }

    return officeId;
  }
}