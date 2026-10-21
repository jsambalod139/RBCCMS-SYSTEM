import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { ConcernPayload } from '../../../core/models/concern.model';
import { ConcernCategoryService } from '../../../core/services/concern-category.service';
import { ConcernService } from '../../../core/services/concern.service';

@Component({
  selector: 'app-resident-submit-concern',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './resident-submit-concern.html',
  styleUrl: './resident-submit-concern.scss'
})
export class ResidentSubmitConcern {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly categoryService = inject(ConcernCategoryService);
  private readonly concernService = inject(ConcernService);

  readonly photoInput =
    viewChild<ElementRef<HTMLInputElement>>('photoInput');

  readonly categories = toSignal(this.categoryService.getCategories(), {
    initialValue: []
  });

  readonly isSubmitted = signal(false);
  readonly isLoading = signal(false);
  readonly showSuccess = signal(false);
  readonly submitError = signal('');
  readonly selectedFile = signal<File | null>(null);
  readonly imagePreview = signal<string | null>(null);
  readonly fileError = signal('');

  readonly concernForm = this.fb.group({
    category_id: ['', Validators.required],
    location_description: ['', [Validators.required, Validators.maxLength(255)]],
    description: ['', [Validators.required, Validators.maxLength(5000)]]
  });

  readonly guidelines = [
    'Select the correct concern category.',
    'Provide a clear and specific location.',
    'Describe the concern accurately.',
    'Attach a photo if available.',
    'Report only non-emergency community concerns.'
  ];

  get categoryControl() {
    return this.concernForm.controls.category_id;
  }
  get locationControl() {
    return this.concernForm.controls.location_description;
  }
  get descriptionControl() {
    return this.concernForm.controls.description;
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    this.fileError.set('');
    this.selectedFile.set(null);
    this.imagePreview.set(null);

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.fileError.set('Please select a valid image file.');
      input.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.fileError.set('The image must not exceed 5 MB.');
      input.value = '';
      return;
    }

    this.selectedFile.set(file);

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.imagePreview.set(reader.result);
      }
    };
    reader.onerror = () => {
      this.fileError.set('Unable to preview this image.');
      this.selectedFile.set(null);
    };
    reader.readAsDataURL(file);
  }

  removePhoto(): void {
    const input = this.photoInput()?.nativeElement;
    if (input) input.value = '';

    this.fileError.set('');
    this.selectedFile.set(null);
    this.imagePreview.set(null);
  }

  submitConcern(): void {
    this.isSubmitted.set(true);
    this.showSuccess.set(false);
    this.submitError.set('');

    if (this.concernForm.invalid) {
      this.concernForm.markAllAsTouched();
      return;
    }

    if (this.fileError() || this.isLoading()) return;

    const value = this.concernForm.getRawValue();
    const payload: ConcernPayload = {
      category_id: Number(value.category_id),
      location_description: value.location_description!.trim(),
      description: value.description!.trim()
    };

    this.isLoading.set(true);

    this.concernService
      .submitConcern(payload, this.selectedFile())
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: () => {
          this.showSuccess.set(true);
          this.resetForm();
        },
        error: (err: HttpErrorResponse) => {
          this.submitError.set(
            err.error?.message ??
              'Unable to submit your concern. Please try again.'
          );
        }
      });
  }

  cancel(): void {
    this.resetForm();
    this.showSuccess.set(false);
    this.submitError.set('');
    void this.router.navigate(['/res-dashboard/resident-dashboard']);
  }

  private resetForm(): void {
    this.concernForm.reset({
      category_id: '',
      location_description: '',
      description: ''
    });
    this.removePhoto();
    this.isSubmitted.set(false);
  }
}