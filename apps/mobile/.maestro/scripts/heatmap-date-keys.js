// Today's and yesterday's local calendar date keys (YYYY-MM-DD), for flows that
// tap a daily-heatmap cell. The cell ids are "<prefix>-heatmap-cell-<dateKey>",
// so a hard-coded date pins a flow to the day it was written; these keys are
// computed at run time instead. The simulator shares the host's time zone, so
// the host's local date is the app's local date (getCurrentLocalDateKey).
//
// Written for Maestro's runScript engine: no padStart, no template literals.
function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function dateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

var now = new Date();
var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

output.todayDateKey = dateKey(now);
output.yesterdayDateKey = dateKey(yesterday);
