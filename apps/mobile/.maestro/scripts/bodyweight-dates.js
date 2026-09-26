// Maestro uses local time just like the app. Relative dates avoid a fixture
// tied to the day this flow was authored. ES5 for Maestro's runScript engine.
function pad(value) { return value < 10 ? '0' + value : String(value); }
function stamp(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
var now = new Date();
output.bodyweightPast = stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 10, 0));
output.bodyweightFuture = stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 10, 0));
