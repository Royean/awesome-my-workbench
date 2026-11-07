import { assetDeadline } from '../public/asset-lifecycle.js';
import { isValidDate } from './dates.mjs';

const recentKinds = {
  task: ['待办', 'tasks'], note: ['备忘', 'notes'], file: ['资料原件', 'documents'],
  visit: ['就诊', 'visit'], report: ['报告', 'visit'], medication: ['用药方案', 'visit'],
  meal: ['饮食', 'meal'], exercise: ['运动', 'exercise'], metric: ['监测', 'metric'],
  water: ['饮水', 'dashboard'], dose: ['服药记录', 'visit'],
  asset_account: ['账户', 'accounts'], asset_holding: ['资产', 'holdings'],
  asset_liability: ['负债', 'liabilities'], asset_transaction: ['流水', 'transactions'],
  asset_snapshot: ['资产快照', 'history'],
  travel_trip: ['旅行', 'dashboard'], travel_stop: ['行程', 'trip'],
  travel_booking: ['预订', 'bookings'], travel_check: ['准备事项', 'checklist'],
  reading_book: ['书籍', 'books'], reading_entry: ['阅读笔记', 'entries'],
};

const dateOrder = (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
const noDateLast = (a, b) => Number(!a.date) - Number(!b.date) || dateOrder(a, b);
const LIMIT = 8;

export function buildOverview(scopes, getItems, today) {
  const upcoming = [];
  const horizon = new Date(Date.parse(today + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  const workbenches = scopes.map(({ id, name, type, themeColor, space }) => {
    const items = getItems(space);
    const activeTrips = new Set(items.filter(item =>
      item.kind === 'travel_trip' && !['completed', 'cancelled'].includes(item.status)
    ).map(item => item.id));
    let pendingCount = 0;
    const recent = [];

    for (const item of items) {
      if (!Object.hasOwn(recentKinds, item.kind)) continue;
      const [kind, defaultRoute] = recentKinds[item.kind];
      let route = defaultRoute;
      if (type === 'health') route = { task: 'dashboard/tasks', note: '', file: 'visit/files' }[item.kind] ?? route;
      if (type === 'reading' && item.kind === 'note') route = '';
      if (type === 'finance' && item.kind === 'asset_holding' && item.assetGroup === 'fixed') route = 'fixed';
      const date = isValidDate(item.date) ? item.date : '';
      const row = {
        workbench: id, workbenchName: name, route, kind,
        title: item.title || item.name || kind,
        date, time: /^\d{2}:\d{2}$/.test(item.time) ? item.time : '',
        ...(item.kind === 'travel_trip' ? { trip: item.id } : item.tripId ? { trip: item.tripId } : {}),
      };
      if (date && date <= today) recent.push(row);

      let pending;
      if (item.kind === 'task' && !item.done) pending = row;
      if (item.kind === 'visit' && item.status !== '已完成' && date >= today && date <= horizon) pending = { ...row, kind: '就诊安排' };
      if (item.kind === 'travel_check' && !item.done && activeTrips.has(item.tripId)) pending = row;
      if (item.kind === 'travel_trip' && activeTrips.has(item.id) && item.startDate >= today && item.startDate <= horizon) {
        pending = { ...row, kind: '旅行出发', date: item.startDate };
      }
      if (item.kind === 'asset_liability' && item.status !== 'closed' && isValidDate(item.dueDate) && item.dueDate <= horizon) {
        pending = { ...row, kind: '负债到期', date: item.dueDate, time: '', route: 'renewals' };
      }
      if (item.kind === 'asset_holding') {
        const deadline = assetDeadline(item, today);
        if (deadline.eligible && ['overdue', 'soon'].includes(deadline.status)) {
          pending = { ...row, kind: deadline.kind === 'renewal' ? '资产续费' : '资产到期', date: deadline.date, time: '', route: 'renewals' };
        }
      }
      if (pending) {
        pendingCount++;
        upcoming.push(pending);
      }
    }
    return { id, name, type, themeColor, pendingCount, recent: recent.sort((a, b) => dateOrder(b, a)).slice(0, 3) };
  });

  return {
    today, workbenches,
    pendingCount: upcoming.length,
    overdueCount: upcoming.filter(item => item.date && item.date < today).length,
    upcoming: upcoming.sort(noDateLast).slice(0, LIMIT),
  };
}
