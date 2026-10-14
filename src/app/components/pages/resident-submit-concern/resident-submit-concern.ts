
import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  signal
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { Router } from '@angular/router';

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
  private readonly fb = new FormBuilder();

  constructor(private readonly router: Router) {}

  // Categories remain empty until real category data is available.
  readonly categories = signal<
    { category_id: number; category_name: string }[]
  >([]);

  readonly isSubmitted = signal(false);
  readonly showSuccess = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly imagePreview = signal<string | null>(null);
  readonly fileError = signal('');

  readonly concernForm = this.fb.group({
    category_id: ['', Validators.required],
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

  get canSubmit(): boolean {
    return this.concernForm.valid &&
      this.categories().length > 0;
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    this.fileError.set('');
    this.clearImagePreview();

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.fileError.set('Please select a valid image file.');
      input.value = '';
      return;
    }

    // Optional client-side limit: 5 MB.
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

  removePhoto(input?: HTMLInputElement): void {
    if (input) {
      input.value = '';
    }

    this.fileError.set('');
    this.selectedFile.set(null);
    this.clearImagePreview();
  }

  private clearImagePreview(): void {
    this.imagePreview.set(null);
  }

  submitConcern(): void {
    this.isSubmitted.set(true);
    this.showSuccess.set(false);

    if (this.concernForm.invalid) {
      this.concernForm.markAllAsTouched();
      return;
    }

    if (this.categories().length === 0) {
      return;
    }

    if (this.fileError()) {
      return;
    }

    // Frontend demonstration only.
    // No concern is saved or sent to a server.
    this.showSuccess.set(true);

    this.concernForm.reset();
    this.removePhoto();

    this.isSubmitted.set(false);
  }

  cancel(): void {
    this.concernForm.reset();
    this.removePhoto();
    this.isSubmitted.set(false);
    this.showSuccess.set(false);

    // Return to the resident dashboard.
    void this.router.navigate([
      '/res-dashboard/resident-dashboard'
    ]);
  }

  ngOnDestroy(): void {
    // No object URLs are created by this component.
  }
}
