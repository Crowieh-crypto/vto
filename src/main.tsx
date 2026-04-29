import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Status = 'За изпълнение' | 'В процес' | 'За преглед' | 'Готово';
type Priority = 'Нисък' | 'Среден' | 'Висок';
type DeadlineType = '10 работни дни - изчакване на отговор' | '14 работни дни' | '20 работни дни' | '30 календарни дни';
type HolidayType = 'Официален празник' | 'Великденски празник' | 'Неприсъствен ден' | 'Допълнителен почивен ден';

type Holiday = {
  date: string;
  name: string;
  type: HolidayType;
};

type Task = {
  id: string;
  regNumber: string;
  regDate: string;
  deadlineType: DeadlineType;
  dueDate: string;
  title: string;
  description: string;
  remaining: string;
  status: Status;
  priority: Priority;
  assignee: string;
  tags: string[];
  createdAt: string;
};

const STATUSES: Status[] = ['За изпълнение', 'В процес', 'За преглед', 'Готово'];
const DEADLINE_TYPES: DeadlineType[] = ['10 работни дни - изчакване на отговор', '14 работни дни', '20 работни дни', '30 календарни дни'];
const STORAGE_KEY = 'flowtasks.tasks.v5';
const LEGACY_STORAGE_KEYS = ['flowtasks.tasks.v4', 'flowtasks.tasks.v3', 'flowtasks.tasks.v2', 'flowtasks.tasks.v1'];

const FIXED_OFFICIAL_HOLIDAYS = [
  { month: 1, day: 1, name: 'Нова година' },
  { month: 3, day: 3, name: 'Ден на Освобождението на България' },
  { month: 5, day: 1, name: 'Ден на труда' },
  { month: 5, day: 6, name: 'Гергьовден / Ден на храбростта и Българската армия' },
  { month: 5, day: 24, name: 'Ден на светите братя Кирил и Методий' },
  { month: 9, day: 6, name: 'Ден на Съединението' },
  { month: 9, day: 22, name: 'Ден на Независимостта' },
  { month: 12, day: 24, name: 'Бъдни вечер' },
  { month: 12, day: 25, name: 'Рождество Христово' },
  { month: 12, day: 26, name: 'Рождество Христово' },
];

// Еднократни почивни дни, обявени с решение на Министерски съвет.
// При ново решение добави дата тук във формат YYYY-MM-DD.
const EXTRA_NON_WORKING_DAYS: Holiday[] = [
  { date: '2025-12-31', name: 'Допълнителен почивен ден за преминаването към еврото', type: 'Допълнителен почивен ден' },
  { date: '2026-01-02', name: 'Допълнителен почивен ден за преминаването към еврото', type: 'Допълнителен почивен ден' },
];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isSameDate(a: Date, b: Date) {
  return toDateInputValue(a) === toDateInputValue(b);
}

function getOrthodoxEasterDate(year: number) {
  // Meeus Julian algorithm, converted to Gregorian calendar.
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julianEaster = new Date(year, month - 1, day);
  const gregorianOffset = year >= 2100 ? 14 : 13;
  return addDays(julianEaster, gregorianOffset);
}

function addHoliday(holidays: Map<string, Holiday>, holiday: Holiday) {
  holidays.set(holiday.date, holiday);
}

function getBulgarianHolidays(year: number) {
  const holidays = new Map<string, Holiday>();

  for (const holiday of FIXED_OFFICIAL_HOLIDAYS) {
    const date = new Date(year, holiday.month - 1, holiday.day);
    addHoliday(holidays, {
      date: toDateInputValue(date),
      name: holiday.name,
      type: 'Официален празник',
    });
  }

  const easter = getOrthodoxEasterDate(year);
  [
    { offset: -2, name: 'Разпети петък' },
    { offset: -1, name: 'Велика събота' },
    { offset: 0, name: 'Великден' },
    { offset: 1, name: 'Великден - понеделник' },
  ].forEach(({ offset, name }) => {
    const date = addDays(easter, offset);
    addHoliday(holidays, {
      date: toDateInputValue(date),
      name,
      type: 'Великденски празник',
    });
  });

  // Когато официален празник без Великден се падне в събота/неделя,
  // първият или първите два работни дни след него са неприсъствени.
  for (const holiday of FIXED_OFFICIAL_HOLIDAYS) {
    const date = new Date(year, holiday.month - 1, holiday.day);
    if (!isWeekend(date)) continue;

    let substitutesToAdd = 1;
    const previousDay = addDays(date, -1);
    const nextDay = addDays(date, 1);

    if (date.getDay() === 0 && previousDay.getFullYear() === year) {
      const fixedHolidayOnSaturday = FIXED_OFFICIAL_HOLIDAYS.some((item) => isSameDate(previousDay, new Date(year, item.month - 1, item.day)));
      if (fixedHolidayOnSaturday) substitutesToAdd = 2;
    }

    if (date.getDay() === 6 && nextDay.getFullYear() === year) {
      const fixedHolidayOnSunday = FIXED_OFFICIAL_HOLIDAYS.some((item) => isSameDate(nextDay, new Date(year, item.month - 1, item.day)));
      if (fixedHolidayOnSunday) substitutesToAdd = 2;
    }

    let cursor = new Date(date);
    let added = 0;
    while (added < substitutesToAdd) {
      cursor = addDays(cursor, 1);
      const key = toDateInputValue(cursor);
      const existingHoliday = holidays.get(key);
      if (isWeekend(cursor) || existingHoliday?.type === 'Официален празник' || existingHoliday?.type === 'Великденски празник') {
        continue;
      }
      addHoliday(holidays, {
        date: key,
        name: `Неприсъствен ден за ${holiday.name}`,
        type: 'Неприсъствен ден',
      });
      added += 1;
    }
  }

  EXTRA_NON_WORKING_DAYS.filter((day) => Number(day.date.slice(0, 4)) === year).forEach((day) => addHoliday(holidays, day));

  return Array.from(holidays.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getHoliday(date: Date) {
  const year = date.getFullYear();
  const key = toDateInputValue(date);
  return getBulgarianHolidays(year).find((holiday) => holiday.date === key) || null;
}

function isNonWorkingDay(date: Date) {
  return isWeekend(date) || Boolean(getHoliday(date));
}

function nextWorkingDay(date: Date) {
  const result = new Date(date);
  while (isNonWorkingDay(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

function addWorkingDays(startDate: string, workingDays: number) {
  let date = parseDate(startDate);
  let added = 0;

  while (added < workingDays) {
    date = addDays(date, 1);
    if (!isNonWorkingDay(date)) {
      added += 1;
    }
  }

  return toDateInputValue(date);
}

function addCalendarDays(startDate: string, days: number) {
  const date = addDays(parseDate(startDate), days);
  return toDateInputValue(nextWorkingDay(date));
}

function calculateDueDate(regDate: string, deadlineType: DeadlineType) {
  if (!regDate) return '';

  if (deadlineType === '10 работни дни - изчакване на отговор') return addWorkingDays(regDate, 10);
  if (deadlineType === '14 работни дни') return addWorkingDays(regDate, 14);
  if (deadlineType === '20 работни дни') return addWorkingDays(regDate, 20);
  return addCalendarDays(regDate, 30);
}

function formatDate(dateValue: string) {
  if (!dateValue) return 'няма дата';
  return parseDate(dateValue).toLocaleDateString('bg-BG');
}

function daysLeft(dueDate: string) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseDate(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
}

function describeNonWorkingDay(dateValue: string) {
  const date = parseDate(dateValue);
  const holiday = getHoliday(date);
  if (holiday) return `${holiday.type}: ${holiday.name}`;
  if (isWeekend(date)) return 'Събота/неделя';
  return 'Работен ден';
}

const today = toDateInputValue(new Date());

const starterTasks: Task[] = [];


function normalizeTask(task: Partial<Task>): Task {
  const regDate = task.regDate || task.createdAt?.slice(0, 10) || today;
  const deadlineType = (task.deadlineType as DeadlineType) || '14 работни дни';

  return {
    id: task.id || crypto.randomUUID(),
    regNumber: task.regNumber || '',
    regDate,
    deadlineType,
    dueDate: calculateDueDate(regDate, deadlineType),
    title: task.title || 'Без заглавие',
    description: task.description || '',
    remaining: task.remaining || '',
    status: task.status === 'Готово' || task.status === 'В процес' || task.status === 'За преглед' ? task.status : 'За изпълнение',
    priority: (task.priority as Priority) || 'Среден',
    assignee: task.assignee || 'Без отговорник',
    tags: Array.isArray(task.tags) ? task.tags : [],
    createdAt: task.createdAt || new Date().toISOString(),
  };
}

function loadTasks(): Task[] {
  const raw = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Partial<Task>[];
    return parsed.map(normalizeTask);
  } catch {
    return [];
  }
}

function isOverdue(task: Task) {
  const left = daysLeft(task.dueDate);
  return left !== null && left < 0 && task.status !== 'Готово';
}

function isDueSoon(task: Task) {
  const left = daysLeft(task.dueDate);
  return left !== null && left >= 0 && left <= 3 && task.status !== 'Готово';
}

function deadlineReminderClass(task: Task) {
  if (task.status === 'Готово') return 'deadline-done';

  const left = daysLeft(task.dueDate);
  if (left === null) return 'deadline-neutral';
  if (left > 7) return 'deadline-green';
  if (left > 3) return 'deadline-yellow';
  return 'deadline-red';
}

function deadlineReminderLabel(task: Task) {
  if (task.status === 'Готово') return 'Завършена';

  const left = daysLeft(task.dueDate);
  if (left === null) return 'Без срок';
  if (left < 0) return 'Просрочена';
  if (left > 7) return 'Зелено';
  if (left > 3) return 'Жълто';
  return 'Червено';
}

function App() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [query, setQuery] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [priority, setPriority] = useState<'all' | Priority>('all');
  const [draft, setDraft] = useState({
    regNumber: '',
    regDate: today,
    deadlineType: '14 работни дни' as DeadlineType,
    title: '',
    description: '',
    remaining: '',
    assignee: '',
    priority: 'Среден' as Priority,
    tags: '',
  });

  const draftDueDate = calculateDueDate(draft.regDate, draft.deadlineType);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const assignees = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.assignee).filter(Boolean))),
    [tasks]
  );

  const filteredTasks = tasks.filter((task) => {
    const text = `${task.regNumber} ${task.title} ${task.description} ${task.remaining} ${task.assignee} ${task.deadlineType} ${task.tags.join(' ')}`.toLowerCase();
    const matchesQuery = text.includes(query.toLowerCase());
    const matchesAssignee = assignee === 'all' || task.assignee === assignee;
    const matchesPriority = priority === 'all' || task.priority === priority;
    return matchesQuery && matchesAssignee && matchesPriority;
  });

  const stats = {
    total: tasks.length,
    open: tasks.filter((task) => task.status !== 'Готово').length,
    dueSoon: tasks.filter(isDueSoon).length,
    overdue: tasks.filter(isOverdue).length,
    done: tasks.filter((task) => task.status === 'Готово').length,
  };

  function createTask(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() && !draft.regNumber.trim()) return;

    const task: Task = {
      id: crypto.randomUUID(),
      regNumber: draft.regNumber.trim(),
      regDate: draft.regDate,
      deadlineType: draft.deadlineType,
      dueDate: draftDueDate,
      title: draft.title.trim() || 'Без заглавие',
      description: draft.description.trim(),
      remaining: draft.remaining.trim(),
      status: 'За изпълнение',
      priority: draft.priority,
      assignee: draft.assignee.trim() || 'Без отговорник',
      tags: draft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      createdAt: new Date().toISOString(),
    };

    setTasks((current) => [task, ...current]);
    setDraft({ regNumber: '', regDate: today, deadlineType: '14 работни дни', title: '', description: '', remaining: '', assignee: '', priority: 'Среден', tags: '' });
  }

  function moveTask(taskId: string, status: Status) {
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, status } : task)));
  }

  function deleteTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }

  function updateTask(taskId: string, updates: Partial<Pick<Task, 'regDate' | 'deadlineType' | 'remaining'>>) {
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        const nextRegDate = updates.regDate ?? task.regDate;
        const nextDeadlineType = updates.deadlineType ?? task.deadlineType;
        return {
          ...task,
          ...updates,
          dueDate: calculateDueDate(nextRegDate, nextDeadlineType),
        };
      })
    );
  }

  return (
    <main className="app-shell">
      <header className="hero simple-hero">
        <h1>Следене на задачи</h1>
      </header>

      <section className="stats-grid">
        <StatCard label="Всички задачи" value={stats.total} />
        <StatCard label="Отворени" value={stats.open} />
        <StatCard label="Червени / до 3 дни" value={stats.dueSoon} warning />
        <StatCard label="Просрочени" value={stats.overdue} danger />
        <StatCard label="Готови" value={stats.done} />
      </section>

      <section className="panel">
        <h2>Нова задача</h2>
        <form className="task-form" onSubmit={createTask}>
          <input placeholder="Рег. №" value={draft.regNumber} onChange={(e) => setDraft({ ...draft, regNumber: e.target.value })} />
          <input type="date" value={draft.regDate} onChange={(e) => setDraft({ ...draft, regDate: e.target.value })} />
          <select value={draft.deadlineType} onChange={(e) => setDraft({ ...draft, deadlineType: e.target.value as DeadlineType })}>
            {DEADLINE_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
          <input value={`Краен срок: ${formatDate(draftDueDate)}`} readOnly aria-label="Автоматично изчислен краен срок" />
          <div className="calendar-note wide">
            <strong>Календар:</strong> сроковете се смятат по работни/почивни дни за България. <strong>Цветове:</strong> зелено над 7 дни, жълто от 7 до 4 дни, червено при 3 или по-малко дни. Добавен е и срок 10 работни дни за изчакване на отговор.
          </div>
          <input className="wide" placeholder="Задача / предмет" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="Отговорник" value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} />
          <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>
            <option>Нисък</option>
            <option>Среден</option>
            <option>Висок</option>
          </select>
          <input className="wide" placeholder="Етикети, разделени със запетая" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
          <textarea className="wide" placeholder="Описание на задачата" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <textarea
            className="wide remaining-input"
            placeholder={'Остава от задачата — напиши какво още трябва да се направи. Може на отделни редове.'}
            value={draft.remaining}
            onChange={(e) => setDraft({ ...draft, remaining: e.target.value })}
          />
          <button className="primary-button" type="submit">Добави задача</button>
        </form>
      </section>


      <section className="toolbar">
        <input placeholder="Търси по рег. №, задача, описание, оставащо, етикет..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="all">Всички отговорници</option>
          {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as 'all' | Priority)}>
          <option value="all">Всички приоритети</option>
          <option value="Нисък">Нисък</option>
          <option value="Среден">Среден</option>
          <option value="Висок">Висок</option>
        </select>
      </section>

      <section className="board">
        {STATUSES.map((status) => {
          const columnTasks = filteredTasks.filter((task) => task.status === status);
          return (
            <div
              className="column"
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => moveTask(event.dataTransfer.getData('taskId'), status)}
            >
              <div className="column-header">
                <h3>{status}</h3>
                <span>{columnTasks.length}</span>
              </div>
              <div className="task-list">
                {columnTasks.map((task) => {
                  const left = daysLeft(task.dueDate);
                  return (
                    <article
                      className={`task-card ${deadlineReminderClass(task)}`}
                      key={task.id}
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData('taskId', task.id)}
                    >
                      <div className="task-card-top">
                        <div>
                          <span className="reg-number">{task.regNumber || 'Без рег. №'}</span>
                          <strong>{task.title}</strong>
                        </div>
                        <button aria-label="Изтрий задача" onClick={() => deleteTask(task.id)}>×</button>
                      </div>
                      <p>{task.description || 'Без описание.'}</p>

                      <section className="deadline-box editable-deadline">
                        <div>
                          <span>Цвят</span>
                          <strong>{deadlineReminderLabel(task)}</strong>
                        </div>
                        <label>
                          <span>Дата</span>
                          <input
                            type="date"
                            value={task.regDate}
                            onChange={(event) => updateTask(task.id, { regDate: event.target.value })}
                          />
                        </label>
                        <label>
                          <span>Срок</span>
                          <select
                            value={task.deadlineType}
                            onChange={(event) => updateTask(task.id, { deadlineType: event.target.value as DeadlineType })}
                          >
                            {DEADLINE_TYPES.map((type) => <option key={type}>{type}</option>)}
                          </select>
                        </label>
                        <div>
                          <span>До кога</span>
                          <strong>{formatDate(task.dueDate)}</strong>
                        </div>
                        <div>
                          <span>Остават</span>
                          <strong className={left !== null && left < 0 ? 'danger-text' : ''}>
                            {left === null ? '-' : left < 0 ? `${Math.abs(left)} дни просрочие` : `${left} дни`}
                          </strong>
                        </div>
                      </section>
                      <div className="deadline-explain">Крайният срок е работен ден: {describeNonWorkingDay(task.dueDate)}.</div>

                      <section className="remaining-box remaining-edit-box">
                        <h4>Остава от задачата</h4>
                        <textarea
                          value={task.remaining}
                          placeholder="Напиши какво още трябва да се направи..."
                          onChange={(event) => updateTask(task.id, { remaining: event.target.value })}
                        />
                      </section>

                      <div className="meta-row">
                        <span>👤 {task.assignee}</span>
                      </div>
                      <div className="tag-row">
                        <span className="priority-pill">{task.priority}</span>
                        {task.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}

function StatCard({ label, value, danger = false, warning = false }: { label: string; value: number; danger?: boolean; warning?: boolean }) {
  return (
    <div className={`stat-card ${danger ? 'danger' : ''} ${warning ? 'warning' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
