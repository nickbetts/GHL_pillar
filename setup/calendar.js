import { get, post } from '../client.js';
import { LOCATION_ID } from '../config.js';

const CALENDAR_NAME = 'Demo Booking';

export async function setupCalendar() {
  // Check if it already exists
  let existing = [];
  try {
    const data = await get('/calendars/', { locationId: LOCATION_ID });
    existing = data?.calendars ?? [];
  } catch (err) {
    return { ok: false, error: `Failed to fetch calendars: ${err.message}` };
  }

  const already = existing.find(
    (c) => c.name?.toLowerCase() === CALENDAR_NAME.toLowerCase()
  );
  if (already) {
    return { ok: true, skipped: true, id: already.id };
  }

  // Create the Demo Booking calendar
  // Use 'event' type — round_robin requires pre-assigned team members
  try {
    const res = await post('/calendars/', {
      locationId: LOCATION_ID,
      name: CALENDAR_NAME,
      description: 'Book a 30-minute Pillar platform demo',
      slotDuration: 30,
      slotInterval: 30,
      slotBuffer: 0,
      preBuffer: 0,
      appoinmentPerSlot: 1,
      appoinmentPerDay: 20,
      openHours: [
        { daysOfTheWeek: [1], hours: [{ openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }] },
        { daysOfTheWeek: [2], hours: [{ openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }] },
        { daysOfTheWeek: [3], hours: [{ openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }] },
        { daysOfTheWeek: [4], hours: [{ openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }] },
        { daysOfTheWeek: [5], hours: [{ openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }] },
      ],
      calendarType: 'event',
      autoConfirm: true,
    });

    const id = res?.calendar?.id ?? res?.id;
    return { ok: true, created: true, id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
