import { CommonModule } from '@angular/common';

import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  getAuth,
  onAuthStateChanged,
} from 'firebase/auth';

import {
  firebaseApp,
} from '../../../core/firebase.config';

import {
  Concern,
} from '../../../core/models/concern.model';

import {
  ConcernService,
} from '../../../core/services/concern.service';

type ReportTab =
  | 'category'
  | 'location'
  | 'office'
  | 'status';

interface Period {
  from: string;
  to: string;
}

interface ReportRow {
  key: string;
  label: string;
  counts: number[];
  total: number;
}

const rememberedPeriods = new Map<string, Period>();

@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-reports.html',
  styleUrl: './admin-reports.scss',
})
export class AdminReports {
  readonly feed = inject(ConcernService);

  private readonly auth = getAuth(firebaseApp);
  private readonly destroyRef = inject(DestroyRef);

  private scopeUid = '';

  private readonly defaults = this.defaultPeriod();

  readonly period = signal<Period>({
    ...this.defaults,
  });

  from = this.defaults.from;
  to = this.defaults.to;

  readonly validation = signal('');
  readonly feedback = signal('');

  readonly tab = signal<ReportTab>('category');

  readonly tabs: {
    id: ReportTab;
    label: string;
  }[] = [
    {
      id: 'category',
      label: 'Categories',
    },
    {
      id: 'location',
      label: 'Locations',
    },
    {
      id: 'office',
      label: 'Responsible Offices',
    },
    {
      id: 'status',
      label: 'Statuses',
    },
  ];

  readonly statuses = [
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected',
    'Not recorded',
  ];

  readonly heading = computed(() => ({
    category: 'Category',
    location: 'Location',
    office: 'Responsible Office',
    status: 'Status',
  })[this.tab()]);

  readonly title = computed(
    () => `Concerns by ${this.heading()}`
  );

  readonly filtered = computed(() => {
    const { from, to } = this.period();

    const start = this.parseDay(from)!.getTime();
    const endDay = this.parseDay(to)!;

    // Include the entire selected final day.
    const end = new Date(
      endDay.getFullYear(),
      endDay.getMonth(),
      endDay.getDate() + 1
    ).getTime();

    return this.feed.concerns().filter(item => {
      const time = Date.parse(item.reported_at);

      return time >= start && time < end;
    });
  });

  readonly undated = computed(() =>
    this.feed.concerns().filter(
      item =>
        !Number.isFinite(
          Date.parse(item.reported_at)
        )
    ).length
  );

  readonly totals = computed(() =>
    this.summarize(this.filtered())
  );

  readonly rows = computed<ReportRow[]>(() => {
    if (this.tab() === 'status') {
      return this.statuses.map((label, index) => ({
        key: label,
        label,
        counts: [],
        total: this.totals().counts[index],
      }));
    }

    const groups = new Map<
      string,
      {
        label: string;
        records: Concern[];
      }
    >();

    for (const record of this.filtered()) {
      let key: string;
      let label: string;

      if (this.tab() === 'category') {
        key = String(record.category_id);

        label =
          record.category?.category_name ||
          `Category ${key}`;
      } else if (this.tab() === 'office') {
        key = record.office_id || '';

        label =
          record.office?.office_name ||
          (
            key
              ? `Office unavailable (${key})`
              : 'Not assigned'
          );
      } else {
        label = (
          record.location_description || ''
        )
          .normalize('NFKC')
          .trim()
          .replace(/\s+/g, ' ');

        key = label.toLowerCase();
        label ||= 'Location not recorded';
      }

      const group = groups.get(key) || {
        label,
        records: [],
      };

      group.records.push(record);
      groups.set(key, group);
    }

    return [...groups]
      .map(([key, group]) => ({
        key,
        label: group.label,
        ...this.summarize(group.records),
      }))
      .sort((a, b) =>
        a.label.localeCompare(
          b.label,
          undefined,
          { numeric: true }
        )
      );
  });

  constructor() {
    this.restore(
      this.auth.currentUser?.uid || ''
    );

    const stop = onAuthStateChanged(
      this.auth,
      user => {
        const uid = user?.uid || '';

        if (uid !== this.scopeUid) {
          this.restore(uid);
        }
      }
    );

    this.destroyRef.onDestroy(stop);
  }

  generate(): void {
    const next = {
      from: this.from,
      to: this.to,
    };

    if (!this.validPeriod(next)) {
      this.validation.set(
        'Choose valid dates. Date From must be on or before Date To.'
      );
      return;
    }

    this.period.set(next);
    this.validation.set('');
    this.feedback.set('');

    if (
      this.scopeUid &&
      this.auth.currentUser?.uid === this.scopeUid
    ) {
      rememberedPeriods.set(
        this.scopeUid,
        next
      );

      try {
        sessionStorage.setItem(
          this.storageKey(),
          JSON.stringify(next)
        );
      } catch {
        // Memory fallback preserves navigation state.
      }
    }
  }

  reset(): void {
    const defaults = this.defaultPeriod();

    this.from = defaults.from;
    this.to = defaults.to;

    this.generate();
  }

  share(value: number): string {
    return `${
      this.totals().total
        ? (
            value /
            this.totals().total *
            100
          ).toFixed(1)
        : '0.0'
    }%`;
  }

  periodLabel(): string {
    const format = (day: string): string =>
      this.parseDay(day)!.toLocaleDateString(
        'en-PH',
        {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }
      );

    return (
      `${format(this.period().from)} – ` +
      `${format(this.period().to)}`
    );
  }

  private summarize(
    records: Concern[]
  ): {
    counts: number[];
    total: number;
  } {
    const counts = this.statuses.map(() => 0);

    for (const record of records) {
      const index = this.statuses.indexOf(
        record.current_status
      );

      counts[
        index < 0
          ? this.statuses.length - 1
          : index
      ]++;
    }

    return {
      counts,
      total: records.length,
    };
  }

  private day(date: Date): string {
    return [
      date.getFullYear(),
      String(
        date.getMonth() + 1
      ).padStart(2, '0'),
      String(
        date.getDate()
      ).padStart(2, '0'),
    ].join('-');
  }

  private parseDay(
    value: string
  ): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    const date = new Date(
      `${value}T00:00:00`
    );

    return (
      Number.isFinite(date.getTime()) &&
      this.day(date) === value
    )
      ? date
      : null;
  }

  private defaultPeriod(): Period {
    const now = new Date();

    return {
      from: this.day(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        )
      ),
      to: this.day(now),
    };
  }

  private validPeriod(
    value: unknown
  ): value is Period {
    if (
      !value ||
      typeof value !== 'object'
    ) {
      return false;
    }

    const item = value as Partial<Period>;

    return (
      typeof item.from === 'string' &&
      typeof item.to === 'string' &&
      !!this.parseDay(item.from) &&
      !!this.parseDay(item.to) &&
      item.from <= item.to
    );
  }

  private storageKey(): string {
    return (
      'rbccms:admin-report-period:v1:' +
      this.scopeUid
    );
  }

  private restore(uid: string): void {
    this.scopeUid = uid;

    let candidate: unknown = uid
      ? rememberedPeriods.get(uid)
      : null;

    if (uid && !candidate) {
      try {
        candidate = JSON.parse(
          sessionStorage.getItem(
            this.storageKey()
          ) || 'null'
        );
      } catch {
        // Use defaults if storage is unavailable.
      }
    }

    const range = this.validPeriod(candidate)
      ? candidate
      : this.defaultPeriod();

    this.from = range.from;
    this.to = range.to;

    this.period.set({ ...range });
    this.validation.set('');
    this.feedback.set('');
    this.tab.set('category');
  }

  private report(): {
    title: string;
    note: string;
    cells: string[][];
  } {
    const statusOnly =
      this.tab() === 'status';

    const rowCells = (
      row: ReportRow
    ): string[] => [
      row.label,
      ...(
        statusOnly
          ? []
          : row.counts.map(String)
      ),
      String(row.total),
      this.share(row.total),
    ];

    const total = this.totals();

    return {
      title: this.title(),

      note:
        `${this.periodLabel()}. ` +
        'All participating offices. ' +
        'Concerns are selected by submission date ' +
        'and counted using their current status. ' +
        (
          this.tab() === 'location'
            ? 'Locations use submitted descriptions; capitalization and extra spaces are ignored. '
            : ''
        ) +
        `${this.undated()} records without a valid ` +
        'submission date excluded. ' +
        'Dates use this browser’s time zone.',

      cells: [
        [
          this.heading(),
          ...(
            statusOnly
              ? []
              : this.statuses
          ),
          'Total',
          'Share',
        ],

        ...this.rows().map(rowCells),

        rowCells({
          key: 'total',
          label: 'Total',
          ...total,
        }),
      ],
    };
  }

  exportCsv(): void {
    if (
      this.feed.loading() ||
      this.feed.error()
    ) {
      return;
    }

    this.feedback.set('');

    const report = this.report();

    const quote = (
      value: string
    ): string => {
      // Prevent spreadsheet formula execution.
      const safe = /^[\s]*[=+@-]/.test(value)
        ? `'${value}`
        : value;

      return `"${safe.replace(/"/g, '""')}"`;
    };

    const content = [
      [report.title],
      [report.note],
      [
        `Generated: ${
          new Date().toLocaleString('en-PH')
        }`,
      ],
      [],
      ...report.cells,
    ]
      .map(row =>
        row.map(quote).join(',')
      )
      .join('\r\n');

    const blob = new Blob(
      ['\uFEFF', content],
      {
        type: 'text/csv;charset=utf-8',
      }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;

    link.download =
      `rbccms-admin-${this.tab()}-` +
      `${this.period().from}-to-` +
      `${this.period().to}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );
  }

  printReport(): void {
    if (
      this.feed.loading() ||
      this.feed.error()
    ) {
      return;
    }

    this.feedback.set('');

    const report = this.report();

    const popup = window.open(
      '',
      '_blank',
      'width=1100,height=800'
    );

    if (!popup) {
      this.feedback.set(
        'Allow pop-ups for this site, then try printing again.'
      );
      return;
    }

    popup.opener = null;

    const doc = popup.document;

    doc.title =
      `RBCCMS — ${report.title}`;

    const style = doc.createElement('style');

    style.textContent = `
      body {
        font: 13px Arial, sans-serif;
        color: #21372a;
        margin: 24px;
      }

      h1 {
        font-size: 22px;
      }

      p {
        line-height: 1.6;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
      }

      td,
      th {
        border: 1px solid #ccd9d0;
        padding: 9px;
        text-align: right;
      }

      td:first-child,
      th:first-child {
        text-align: left;
        overflow-wrap: anywhere;
      }

      thead,
      tfoot {
        background: #edf3ef;
        font-weight: bold;
      }

      @page {
        size: A4 landscape;
        margin: 14mm;
      }
    `;

    doc.head.appendChild(style);

    const appendText = (
      tag: string,
      text: string
    ): void => {
      const element =
        doc.createElement(tag);

      element.textContent = text;
      doc.body.appendChild(element);
    };

    appendText(
      'h1',
      `RBCCMS — ${report.title}`
    );

    appendText('p', report.note);

    appendText(
      'p',
      `Generated: ${
        new Date().toLocaleString('en-PH')
      }`
    );

    const table =
      doc.createElement('table');

    report.cells.forEach((cells, index) => {
      const section = doc.createElement(
        index === 0
          ? 'thead'
          : index === report.cells.length - 1
            ? 'tfoot'
            : 'tbody'
      );

      const row = doc.createElement('tr');

      cells.forEach(value => {
        const cell = doc.createElement(
          index === 0 ? 'th' : 'td'
        );

        cell.textContent = value;
        row.appendChild(cell);
      });

      section.appendChild(row);
      table.appendChild(section);
    });

    doc.body.appendChild(table);

    popup.requestAnimationFrame(() => {
      if (!popup.closed) {
        popup.focus();
        popup.print();
      }
    });
  }
}