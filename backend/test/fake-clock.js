// Test-only: `node --require test/fake-clock.js` moves the clock of the process to DEMO_TODAY (YYYY-MM-DD, noon UTC), so
// the demo seed and the API it boots agree on a day other than the real one.
const RealDate = Date;
const target = RealDate.parse(`${process.env.DEMO_TODAY}T12:00:00Z`);
if (Number.isNaN(target))
  throw new Error('fake-clock: DEMO_TODAY must be YYYY-MM-DD');
const shift = target - RealDate.now();
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + shift);
    else super(...args);
  }
  static now() {
    return RealDate.now() + shift;
  }
}
global.Date = FakeDate;
