import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PersonnelResidents } from './personnel-residents';

describe('PersonnelResidents', () => {
  let component: PersonnelResidents;
  let fixture: ComponentFixture<PersonnelResidents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PersonnelResidents],
    }).compileComponents();

    fixture = TestBed.createComponent(PersonnelResidents);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
