import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  Concern,
  ConcernStatus
} from '../../../core/models/concern.model';

import {
  ConcernService
} from '../../../core/services/concern.service';

import {
  ResidentService
} from '../../../core/services/resident.service';

type Tab = 'summary' | 'offices' | 'residents';

interface SummaryRow {
  label: string;
  counts: Record<ConcernStatus, number>;
  total: number;
}

interface ResidentRow {
  label: string;
  total: number;
  verified: number;
  approved: number;
}

@Component({
  selector: 'app-personnel-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './personnel-reports.html',
  styleUrl: './personnel-reports.scss'
})
export class PersonnelReports {
  private readonly concernService = inject(ConcernService);
  private readonly residentService = inject(ResidentService);

  readonly tab = signal<Tab>('summary');

  readonly statuses: ConcernStatus[] = [
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected'
  ];

  private readonly today = new Date();

  private readonly initialFrom = this.localDay(
    new Date(
      this.today.getFullYear(),
      this.today.getMonth(),
      1
    )
  );

  private readonly initialTo = this.localDay(this.today);

  from = this.initialFrom;
  to = this.initialTo;

  readonly period = signal({
    from: this.initialFrom,
    to: this.initialTo
  });

  readonly validation = signal('');
  readonly exportError = signal('');

  readonly loading = computed(() =>
    this.tab() === 'residents'
      ? this.residentService.loading()
      : this.concernService.loading()
  );

  readonly error = computed(() =>
    this.tab() === 'residents'
      ? this.residentService.error()
      : this.concernService.error()
  );

  readonly filtered = computed(() => {
    const period = this.period();

    return this.concernService.concerns().filter(concern => {
      const date = new Date(concern.reported_at);

      if (!Number.isFinite(date.getTime())) {
        return false;
      }

      const day = this.localDay(date);

      return day >= period.from && day <= period.to;
    });
  });

  readonly totals = computed(() =>
    this.summarize(this.filtered())
  );

  readonly categories = computed(() =>
    this.group(this.filtered(), concern => [
      String(concern.category_id),
      concern.category?.category_name ||
        `Category ${concern.category_id}`
    ])
  );

  readonly offices = computed(() =>
    this.group(this.filtered(), concern => [
      concern.office_id || '',
      concern.office?.office_name ||
        (
          concern.office_id
            ? `Office unavailable (${concern.office_id})`
            : 'Not assigned'
        )
    ])
  );

  readonly rows = computed(() =>
    this.tab() === 'offices'
      ? this.offices()
      : this.categories()
  );

  readonly residents = this.residentService.residents;

  readonly residentTotals = computed(() => ({
    total: this.residents().length,

    verified: this.residents().filter(
      item => item.residencyVerified
    ).length,

    approved: this.residents().filter(
      item => item.accountStatus === 'approved'
    ).length
  }));

  readonly puroks = computed(() => {
    const groups = new Map<string, ResidentRow>();

    for (const resident of this.residents()) {
      const label = resident.purok.trim() || 'Not recorded';

      const row = groups.get(label) || {
        label,
        total: 0,
        verified: 0,
        approved: 0
      };

      row.total++;

      if (resident.residencyVerified) {
        row.verified++;
      }

      if (resident.accountStatus === 'approved') {
        row.approved++;
      }

      groups.set(label, row);
    }

    return [...groups.values()].sort((a, b) =>
      a.label.localeCompare(
        b.label,
        undefined,
        { numeric: true }
      )
    );
  });

  generate(): void {
    const start = this.parseDay(this.from);
    const end = this.parseDay(this.to);

    if (!start || !end || this.from > this.to) {
      this.validation.set(
        'Choose valid dates. Date From must be on or before Date To.'
      );
      return;
    }

    this.period.set({
      from: this.from,
      to: this.to
    });

    this.validation.set('');
    this.exportError.set('');
  }

  reset(): void {
    this.from = this.initialFrom;
    this.to = this.initialTo;
    this.generate();
  }

  retry(): void {
    if (this.tab() === 'residents') {
      this.residentService.reload();
    } else {
      this.concernService.reload();
    }
  }

  periodLabel(): string {
    const period = this.period();

    const format = (day: string): string =>
      this.parseDay(day)!.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

    return `${format(period.from)} – ${format(period.to)}`;
  }

  share(count: number, total: number): string {
    return `${
      total
        ? (count / total * 100).toFixed(1)
        : '0.0'
    }%`;
  }

  private localDay(date: Date): string {
    const year = date.getFullYear();

    const month = String(
      date.getMonth() + 1
    ).padStart(2, '0');

    const day = String(
      date.getDate()
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private parseDay(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    const date = new Date(`${value}T00:00:00`);

    return (
      Number.isFinite(date.getTime()) &&
      this.localDay(date) === value
    )
      ? date
      : null;
  }

  private summarize(records: Concern[]): SummaryRow {
    const row: SummaryRow = {
      label: 'Total',
      total: records.length,

      counts: {
        Pending: 0,
        'In Progress': 0,
        Resolved: 0,
        Rejected: 0
      }
    };

    for (const record of records) {
      row.counts[record.current_status]++;
    }

    return row;
  }

  private group(
    records: Concern[],
    identify: (item: Concern) => string[]
  ): SummaryRow[] {
    const groups = new Map<
      string,
      { label: string; records: Concern[] }
    >();

    for (const record of records) {
      const [key, label] = identify(record);

      const group = groups.get(key) || {
        label,
        records: []
      };

      group.records.push(record);
      groups.set(key, group);
    }

    return [...groups.values()]
      .map(group => ({
        ...this.summarize(group.records),
        label: group.label
      }))
      .sort((a, b) =>
        a.label.localeCompare(b.label)
      );
  }

  private report(): {
    title: string;
    note: string;
    cells: string[][];
  } {
    if (this.tab() === 'residents') {
      const total = this.residentTotals();

      return {
        title: 'Resident Accounts',

        note:
          'All current registered accounts; date filters do not apply. ' +
          'These figures do not represent the entire barangay population.',

        cells: [
          [
            'Purok',
            'Accounts',
            'Verified',
            'Not verified',
            'Approved',
            'Other account statuses',
            'Share'
          ],

          ...this.puroks().map(row => [
            row.label,
            String(row.total),
            String(row.verified),
            String(row.total - row.verified),
            String(row.approved),
            String(row.total - row.approved),
            this.share(row.total, total.total)
          ]),

          [
            'Total',
            String(total.total),
            String(total.verified),
            String(total.total - total.verified),
            String(total.approved),
            String(total.total - total.approved),
            this.share(total.total, total.total)
          ]
        ]
      };
    }

    const total = this.totals();

    const cells = (row: SummaryRow): string[] => [
      row.label,
      ...this.statuses.map(status =>
        String(row.counts[status])
      ),
      String(row.total),
      this.share(row.total, total.total)
    ];

    return {
      title:
        this.tab() === 'offices'
          ? 'Responsible Offices'
          : 'Concern Summary',

      note:
        `${this.periodLabel()}. ` +
        'Concerns submitted during this period, grouped by current status at generation time.',

      cells: [
        [
          this.tab() === 'offices'
            ? 'Responsible Office'
            : 'Category',
          ...this.statuses,
          'Total',
          'Share'
        ],

        ...this.rows().map(cells),
        cells(total)
      ]
    };
  }

  exportCsv(): void {
    if (this.loading() || this.error()) {
      return;
    }

    const report = this.report();

    const quote = (value: string): string => {
      // Prevent spreadsheet formulas from executing.
      const safe = /^[\s]*[=+@-]/.test(value)
        ? `'${value}`
        : value;

      return `"${safe.replace(/"/g, '""')}"`;
    };

    const content = [
      [report.title],
      [report.note],
      [`Generated: ${new Date().toLocaleString('en-PH')}`],
      [],
      ...report.cells
    ]
      .map(row => row.map(quote).join(','))
      .join('\r\n');

    const blob = new Blob(
      ['\uFEFF', content],
      { type: 'text/csv;charset=utf-8' }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download =
      `rbccms-${this.tab()}-${this.localDay(new Date())}.csv`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  printReport(): void {
    if (this.loading() || this.error()) {
      return;
    }

    const report = this.report();

    const popup = window.open(
      '',
      '_blank',
      'width=1100,height=800'
    );

    if (!popup) {
      this.exportError.set(
        'Allow pop-ups for this site, then try printing again.'
      );
      return;
    }

    popup.opener = null;

    const escape = (value: string): string =>
      value.replace(/[&<>"']/g, char =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[char]!)
      );

    const table = report.cells
      .map((row, index) =>
        `<tr>${
          row.map(value =>
            `<${index ? 'td' : 'th'}>` +
            escape(value) +
            `</${index ? 'td' : 'th'}>`
          ).join('')
        }</tr>`
      )
      .join('');

    popup.document.write(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>RBCCMS — ${escape(report.title)}</title>

          <style>
            body {
              font: 13px Arial, sans-serif;
              color: #21372a;
              margin: 30px;
            }

            h1 {
              font-size: 22px;
            }

            p {
              line-height: 1.5;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 24px;
            }

            th,
            td {
              border: 1px solid #ccd5ce;
              padding: 9px;
              text-align: right;
            }

            th:first-child,
            td:first-child {
              text-align: left;
            }

            th,
            tr:last-child {
              background: #eef3ef;
              font-weight: bold;
            }

            @page {
              size: A4 landscape;
              margin: 14mm;
            }
          </style>
        </head>

        <body>
          <h1>RBCCMS — ${escape(report.title)}</h1>
          <p>${escape(report.note)}</p>

          <p>
            Generated:
            ${escape(new Date().toLocaleString('en-PH'))}
          </p>

          <table>${table}</table>
        </body>
      </html>
    `);

    popup.document.close();

    popup.onload = () => {
      popup.focus();
      popup.print();
    };
  }
}