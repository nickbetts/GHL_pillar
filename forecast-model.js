/* Year-one forecast model shared by the Offerings page and the Targets page.
   Benchmarks only: clients churn, move up a package and add a website, shop or CRM on top. */
(function (root) {
  // Forecast benchmarks. Only "new clients a month" is editable on the page.
  const FC = {
    price: { gf: 1000, gl: 1750, dom: 2995 },
    mix: { gf: 0.5, gl: 0.4, dom: 0.1 },
    churnYr: { gf: 0.38, gl: 0.25, dom: 0.18 },
    sticky: 0.7,
    up: { gfGl: { p: 0.28, age: 3 }, glDom: { p: 0.18, age: 6 } },
    siteLifeYrs: 2.6, take: 0.28, lowTake: 0.187, sellOnline: 0.27, hasCrm: 0.183, bigTicket: 1 / 3,
    siteSplit: { static: 0.6, wp: 0.4 },
    item: { static: { build: 1000, care: 150 }, wp: { build: 5000, care: 150 }, ecom: { build: 5000, care: 400 }, wpEcom: { build: 12500, care: 400 }, crm: { build: 5000, care: 349 } },
  };
  FC.p = {
    static: (1 / FC.siteLifeYrs) * FC.take * FC.siteSplit.static,
    wp: (1 / FC.siteLifeYrs) * FC.take * FC.siteSplit.wp,
    ecom: FC.sellOnline * (1 / FC.siteLifeYrs) * FC.take,
    crm: (1 - FC.hasCrm) * FC.lowTake * FC.bigTicket,
  };

  const FC_TIERS = ['gf', 'gl', 'dom'];
  const FC_KINDS = ['plain', 'static', 'wp', 'ecom', 'crm'];

  function simulate(newPerMonth, withChurn) {
    const mc = {};
    FC_TIERS.forEach((t) => { mc[t] = withChurn ? 1 - Math.pow(1 - FC.churnYr[t], 1 / 12) : 0; });
    const cohorts = [];
    const months = [];
    for (let m = 1; m <= 12; m++) {
      let oneOff = 0;
      for (const co of cohorts) {
        const age = m - co.m;
        FC_TIERS.forEach((t) => FC_KINDS.forEach((k) => { co.b[t][k] -= co.b[t][k] * mc[t] * (k === 'plain' ? 1 : FC.sticky); }));
        const move = (from, to, pr) => FC_KINDS.forEach((k) => { const mv = co.b[from][k] * pr; co.b[from][k] -= mv; co.b[to][k] += mv; });
        if (age === FC.up.gfGl.age) move('gf', 'gl', FC.up.gfGl.p);
        if (age === FC.up.glDom.age) move('gl', 'dom', FC.up.glDom.p);
        if (age === 6) {
          ['gl', 'dom'].forEach((t) => { const mv = co.b[t].plain * FC.p.crm; co.b[t].plain -= mv; co.b[t].crm += mv; oneOff += mv * FC.item.crm.build; });
        }
      }
      const co = { m, b: {} };
      FC_TIERS.forEach((t) => {
        const nt = newPerMonth * FC.mix[t];
        const held = { static: nt * FC.p.static, wp: nt * FC.p.wp, ecom: nt * FC.p.ecom, crm: 0 };
        co.b[t] = { plain: nt - held.static - held.wp - held.ecom, ...held };
      });
      cohorts.push(co);
      oneOff += newPerMonth * (FC.p.static * FC.item.static.build + FC.p.wp * FC.item.wp.build + FC.p.ecom * FC.item.ecom.build);
      const rev = { gf: 0, gl: 0, dom: 0, care: 0, one: oneOff };
      const count = { gf: 0, gl: 0, dom: 0 };
      for (const c of cohorts) {
        FC_TIERS.forEach((t) => FC_KINDS.forEach((k) => {
          const n = c.b[t][k];
          count[t] += n;
          rev[t] += n * FC.price[t];
          if (k !== 'plain') rev.care += n * FC.item[k].care;
        }));
      }
      months.push({ m, rev, count });
    }
    return months;
  }

  /** rates are fractions (0 to 1). Returns the monthly funnel for a team at a given dial rate. */
  function chain({ reps, dialsPerDay, workDays, rates }) {
    const dials = reps * dialsPerDay * workDays;
    const answered = dials * rates.connection;
    const interested = answered * rates.qualification;
    const booked = interested * rates.booking;
    const attended = booked * rates.showup;
    const won = attended * rates.close;
    return { dials, answered, interested, booked, attended, won };
  }

  /** Dials per rep per day needed to win clientsPerMonth at these rates. Infinity when a rate is zero. */
  function dialsNeeded({ clientsPerMonth, reps, workDays, rates }) {
    const yieldPerDial = rates.connection * rates.qualification * rates.booking * rates.showup * rates.close;
    if (!(yieldPerDial > 0) || !(reps > 0) || !(workDays > 0)) return Infinity;
    return clientsPerMonth / yieldPerDial / reps / workDays;
  }

  root.ForecastModel = { FC, simulate, chain, dialsNeeded };
})(typeof window !== 'undefined' ? window : globalThis);
