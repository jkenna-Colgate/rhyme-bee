/**
 * Re-sorting each week of the Schedule by Difficulty (#312, ADR-0012 amended
 * 2026-11-10).
 *
 * The banded deal made every week ramp Monday easiest to Sunday hardest, and
 * a place keeps its weekday. When the Answer and rare lines moved (#307), the
 * Difficulty of nearly every day moved with them and the ramp broke in every
 * week, so each week was re-sorted once. This is that re-sort: every Seed Word
 * stays in the week it was in, and only the order within the week changes.
 *
 * A week here is a week as it is played, Monday to Sunday, round the loop. The
 * committed lap begins on a Tuesday, so the week that opens each later lap is
 * the last listed day (a Monday) followed by the first six of the lap.
 *
 * The week holding today is left exactly as it is: a player part way through
 * it must not meet a Seed Word they have already played this week. Weeks
 * already played this lap are re-sorted too, and come round in ramp order on
 * the next lap. Days listed before the lap begins are played once and gone, so
 * they are left alone.
 *
 * Nothing here reads or writes a file: `scripts/resort-weeks.ts` does both.
 */

import { daysBetween, DAYS_PER_WEEK, weekdayOf, WEEKDAYS, type Schedule, type ScheduleDay } from "./schedule.ts";

/** A listed day's figures as the built index measures them now. */
export interface Measured {
  answerCount: number;
  difficulty: number;
}

/**
 * The loop's listed days, and where a date falls in the played weeks of the
 * lap: its slot, counted Monday first from the played week the lap begins in
 * and wrapping both ways, so the week that opens a lap (the last listed
 * Monday, then the lap's first days) is seven slots like any other.
 */
function loopOf(schedule: Schedule) {
  const { lapStart } = schedule;
  if (lapStart === undefined) throw new Error("the Schedule records no lap start, so it has no weeks to re-sort");
  const first = schedule.days.findIndex((d) => d.date === lapStart);
  const loop = first === -1 ? [] : schedule.days.slice(first);
  const lap = loop.length;
  if (lap === 0 || lap % DAYS_PER_WEEK !== 0) throw new Error("the Schedule's lap is not a whole number of weeks");
  // How far into its played week the lap's first day falls: 1 for a Tuesday.
  const offset = WEEKDAYS.indexOf(weekdayOf(lapStart));
  const slotOf = (date: string) => (((daysBetween(lapStart, date) + offset) % lap) + lap) % lap;
  return { first, loop, slotOf };
}

/** Which played week of the lap a date is in, counting from 0: the same number on every lap. */
export function playedWeekOf(schedule: Schedule, date: string): number {
  return Math.floor(loopOf(schedule).slotOf(date) / DAYS_PER_WEEK);
}

/**
 * The Schedule with every played week but the one holding `today` in ramp
 * order by `measured` (keyed by each listed day's date). Ties keep their
 * current relative order, so the result is deterministic. Every day of a
 * re-sorted week takes the figures it was sorted on, recorded to the precision
 * the Schedule was dealt with, so the file reads in ramp order by its own
 * figures; each date keeps its weekday and week.
 */
export function resortWeeks(schedule: Schedule, measured: ReadonlyMap<string, Measured>, today: string): Schedule {
  const { first, loop, slotOf } = loopOf(schedule);
  const todayWeek = playedWeekOf(schedule, today);
  const figures = (date: string): Measured => {
    const m = measured.get(date);
    if (m === undefined) throw new Error(`no Difficulty measured for ${date}`);
    return m;
  };

  const weeks = new Map<number, ScheduleDay[]>();
  for (const day of [...loop].sort((a, b) => slotOf(a.date) - slotOf(b.date))) {
    const week = Math.floor(slotOf(day.date) / DAYS_PER_WEEK);
    if (week !== todayWeek) weeks.set(week, [...(weeks.get(week) ?? []), day]);
  }

  const byDate = new Map(loop.map((d) => [d.date, d]));
  for (const week of weeks.values()) {
    // Array.prototype.sort is stable, so a tie keeps its current order.
    const byDifficulty = [...week].sort((a, b) => figures(a.date).difficulty - figures(b.date).difficulty);
    week.forEach((slot, i) => {
      const { seed, rhymeKey, date } = byDifficulty[i]!;
      const { answerCount, difficulty } = figures(date);
      byDate.set(slot.date, { ...slot, seed, rhymeKey, answerCount, difficulty: Number(difficulty.toFixed(4)) });
    });
  }

  return { ...schedule, days: [...schedule.days.slice(0, first), ...loop.map((d) => byDate.get(d.date)!)] };
}
