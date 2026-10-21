import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { ConcernCategory } from '../models/concern.model';

@Injectable({ providedIn: 'root' })
export class ConcernCategoryService {
  private readonly categories: ConcernCategory[] = [
    { category_id: 1, category_name: 'Road and Infrastructure' },
    { category_id: 2, category_name: 'Water Supply' },
    { category_id: 3, category_name: 'Streetlights' },
    { category_id: 4, category_name: 'Waste Management' },
    { category_id: 5, category_name: 'Public Facilities' },
    { category_id: 6, category_name: 'Drainage and Flooding' },
    { category_id: 7, category_name: 'Environmental Concerns' },
    { category_id: 8, category_name: 'Other Community Concerns' }
  ];

  getCategories(): Observable<ConcernCategory[]> {
    return of(this.categories);
    // Later, when your API is ready:
    // return this.http.get<ConcernCategory[]>(`${environment.apiUrl}/categories`);
  }

  getById(categoryId: number): ConcernCategory | undefined {
    return this.categories.find((c) => c.category_id === categoryId);
  }
}