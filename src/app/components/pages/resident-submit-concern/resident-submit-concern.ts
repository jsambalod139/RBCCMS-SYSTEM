
import { CommonModule } from '@angular/common';

import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';

import { toSignal } from '@angular/core/rxjs-interop';

import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';

import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import {
  compressConcernPhoto
} from '../../../core/utils/compress-concern-photo';

import {
  ConcernPayload
} from '../../../core/models/concern.model';

import {
  ConcernCategoryService
} from '../../../core/services/concern-category.service';

import {
  ConcernService
} from '../../../core/services/concern.service';

@Component({
  selector: 'app-resident-submit-concern',
  standalone: true,

  imports: [
    CommonModule,
    ReactiveFormsModule
  ],

  templateUrl: './resident-submit-concern.html',
  styleUrl: './resident-submit-concern.scss'
})
export class ResidentSubmitConcern implements OnDestroy {

  private readonly fb =
    inject(FormBuilder);

  private readonly router =
    inject(Router);

  private readonly categoryService =
    inject(ConcernCategoryService);

  private readonly concernService =
    inject(ConcernService);

  readonly photoInput =
    viewChild<ElementRef<HTMLInputElement>>(
      'photoInput'
    );

  readonly categories = toSignal(
    this.categoryService.getCategories(),
    { initialValue: [] }
  );

  readonly isSubmitted = signal(false);
  readonly isLoading = signal(false);
  readonly showSuccess = signal(false);
  readonly submitError = signal('');

  readonly selectedFile =
    signal<File | null>(null);

  readonly imagePreview =
    signal<string | null>(null);

  readonly fileError = signal('');
  readonly isProcessingPhoto = signal(false);

  private photoVersion = 0;
  private destroyed = false;

  // CONCERN FORM

  readonly concernForm = this.fb.group({

    category_id: [
      '',
      Validators.required
    ],

    location_description: [
      '',
      [
        Validators.required,
        Validators.maxLength(255)
      ]
    ],

    description: [
      '',
      [
        Validators.required,
        Validators.maxLength(5000)
      ]
    ]

  });

  // MONITOR CATEGORY AVAILABILITY
  // Clear the selected category if the office
  // or category becomes inactive.
  // Do not interrupt an ongoing submission.
  // The transaction checks availability again.

  private readonly watchCategoryAvailability =
    effect(() => {

      const categories = this.categories();

      const loading =
        this.categoryService.loading();

      const submitting = this.isLoading();

      if (loading || submitting) return;

      const selected =
        this.categoryControl.value;

      if (
        selected &&
        !categories.some(category =>
          category.category_id === Number(selected)
        )
      ) {

        this.categoryControl.setValue('');

        this.categoryControl.markAsTouched();

        this.submitError.set(
          'The selected category is no longer available. Please choose another category.'
        );

      }
    });

  // SUBMISSION GUIDELINES

  readonly guidelines = [
    'Select the correct concern category.',
    'Provide a clear and specific location.',
    'Describe the concern accurately.',
    'Attach a photo if available.',
    'Report only non-emergency community concerns.'
  ];

  // FORM CONTROLS

  get categoryControl() {
    return this.concernForm.controls.category_id;
  }

  get locationControl() {
    return this.concernForm.controls.location_description;
  }

  get descriptionControl() {
    return this.concernForm.controls.description;
  }

  // PHOTO SELECTION AND VALIDATION

  async onPhotoSelected(
    event: Event
  ): Promise<void> {

    const input =
      event.target as HTMLInputElement;

    const file = input.files?.[0];

    if (this.isLoading()) return;

    const version = ++this.photoVersion;

    this.clearPreview();

    this.fileError.set('');
    this.isProcessingPhoto.set(false);

    if (!file) return;

    this.isProcessingPhoto.set(true);

    try {

      const compressed =
        await compressConcernPhoto(file);

      if (
        this.destroyed ||
        version !== this.photoVersion
      ) {
        return;
      }

      this.selectedFile.set(compressed);

      this.imagePreview.set(
        URL.createObjectURL(compressed)
      );

    } catch (error) {

      if (
        this.destroyed ||
        version !== this.photoVersion
      ) {
        return;
      }

      input.value = '';

      this.fileError.set(
        error instanceof Error
          ? error.message
          : 'Unable to process this photo.'
      );

    } finally {

      if (
        !this.destroyed &&
        version === this.photoVersion
      ) {
        this.isProcessingPhoto.set(false);
      }

    }
  }

  // REMOVE SELECTED PHOTO

  removePhoto(): void {

    ++this.photoVersion;

    const input =
      this.photoInput()?.nativeElement;

    if (input) {
      input.value = '';
    }

    this.clearPreview();

    this.fileError.set('');
    this.isProcessingPhoto.set(false);
  }

  // CLEAR PHOTO PREVIEW

  private clearPreview(): void {

    const url = this.imagePreview();

    if (url) {
      URL.revokeObjectURL(url);
    }

    this.imagePreview.set(null);
    this.selectedFile.set(null);
  }

  // SUBMIT CONCERN

  submitConcern(): void {

    this.isSubmitted.set(true);
    this.showSuccess.set(false);
    this.submitError.set('');

    // EXISTING FORM VALIDATION

    if (this.concernForm.invalid) {

      this.concernForm.markAllAsTouched();

      return;
    }

    // EXISTING PHOTO AND SUBMISSION VALIDATION

    if (
      this.fileError() ||
      this.isLoading() ||
      this.isProcessingPhoto()
    ) {
      return;
    }

    const value =
      this.concernForm.getRawValue();

    // ADDITIONAL CATEGORY AVAILABILITY VALIDATION
    // Reject unavailable categories before
    // uploading any photo.

    if (
      this.categoryService.loading() ||

      this.categoryService.error() ||

      !this.categories().some(category =>
        category.category_id === Number(
          value.category_id
        )
      )
    ) {

      this.submitError.set(
        'The selected category is unavailable. Please choose an active category.'
      );

      return;
    }

    // EXISTING CONCERN PAYLOAD

    const payload: ConcernPayload = {

      category_id:
        Number(value.category_id),

      location_description:
        value.location_description!.trim(),

      description:
        value.description!.trim()

    };

    this.isLoading.set(true);

    // EXISTING CONCERN SUBMISSION SERVICE

    this.concernService

      .submitConcern(
        payload,
        this.selectedFile()
      )

      .pipe(
        finalize(() =>
          this.isLoading.set(false)
        )
      )

      .subscribe({

        next: () => {

          this.showSuccess.set(true);

          this.resetForm();

        },

        error: (error: unknown) => {

          this.submitError.set(
            error instanceof Error
              ? error.message
              : 'Unable to submit your concern. Please try again.'
          );

        }

      });
  }

  // CANCEL SUBMISSION

  cancel(): void {

    if (this.isLoading()) return;

    this.resetForm();

    this.showSuccess.set(false);
    this.submitError.set('');

    void this.router.navigate([
      '/res-dashboard/resident-dashboard'
    ]);
  }

  // RESET FORM

  private resetForm(): void {

    this.concernForm.reset({

      category_id: '',
      location_description: '',
      description: ''

    });

    this.removePhoto();

    this.isSubmitted.set(false);
  }

  // CLEANUP

  ngOnDestroy(): void {

    this.destroyed = true;

    ++this.photoVersion;

    this.clearPreview();
  }
}
