import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResidentService } from '../../../../core/services/resident.service';
@Component({
  selector: 'app-personnel-sidebar', standalone: true, imports: [RouterLink],
  templateUrl: './personnel-sidebar.html', styleUrl: './personnel-sidebar.scss',
})
export class PersonnelSidebar {
  readonly canManageResidents = inject(ResidentService).canManageResidents;
}
