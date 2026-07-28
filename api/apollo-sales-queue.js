import { get, post, put } from '../client.js';
import { getContactsFromList, enrichContactData } from './apollo-client.js';

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const DEFAULT_APOLLO_LIST_ID = process.env.APOLLO_LIST_ID;

function classifyPriority(contact) {
  const title = `${contact?.title || ''} ${contact?.job_title || ''}`.toLowerCase();
  const employeeCount = contact?.company?.num_employees || contact?.company?.employee_count;
  const revenue = contact?.company?.annual_revenue;

  if (/vp|director|head|chief|founder|owner|president|partner/.test(title) || employeeCount >= 1000 || revenue >= 5000000) {
    return 'hot';
  }

  if (/manager|lead|principal|consultant/.test(title) || employeeCount >= 200 || revenue >= 1000000) {
    return 'warm';
  }

  return 'cold';
}

function normalizeContact(rawContact) {
  const contact = rawContact?.contact || rawContact;
  const company = rawContact?.company || rawContact?.organization || {};
  const email = rawContact?.email || contact?.email || rawContact?.contact?.email;
  const priority = classifyPriority({ title: contact?.title, company: company });

  return {
    id: rawContact?.id || contact?.id,
    name: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || rawContact?.name || contact?.name,
    title: contact?.title,
    email,
    phone: contact?.phone_number || contact?.phone_numbers?.[0],
    companyName: company?.name,
    companyIndustry: company?.industry,
    companyEmployees: company?.num_employees || company?.employee_count,
    companyRevenue: company?.annual_revenue,
    priority,
    raw: rawContact,
  };
}

function buildGHLContactPayload(apolloContact) {
  const contactData = enrichContactData(apolloContact);
  return {
    ...contactData,
    tags: ['apollo-list', 'sales-queue', `priority-${apolloContact.priority || 'warm'}`],
    source: 'Apollo Queue',
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const listId = req.query?.listId || DEFAULT_APOLLO_LIST_ID;
      if (!listId) {
        return res.status(400).json({ error: 'No Apollo list ID provided. Set APOLLO_LIST_ID or pass ?listId=' });
      }

      const contacts = await getContactsFromList(listId);
      const normalized = contacts.map(normalizeContact).filter((entry) => entry.email);

      return res.status(200).json({
        success: true,
        listId,
        contacts: normalized,
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { contact, listId = DEFAULT_APOLLO_LIST_ID, action = 'convert' } = req.body || {};
      if (!contact?.email) {
        return res.status(400).json({ success: false, error: 'A contact email is required' });
      }

      if (action === 'convert') {
        const payload = buildGHLContactPayload(contact);
        const email = contact.email;

        let existingContact;
        try {
          existingContact = await get(`/contacts/${email}`, { locationId: LOCATION_ID });
        } catch {
          existingContact = null;
        }

        if (existingContact?.contact?.id) {
          await put(`/contacts/${existingContact.contact.id}`, {
            locationId: LOCATION_ID,
            ...payload,
          });

          return res.status(200).json({
            success: true,
            mode: 'updated',
            contactId: existingContact.contact.id,
            email,
            listId,
          });
        }

        const created = await post('/contacts/', {
          locationId: LOCATION_ID,
          ...payload,
        });

        return res.status(200).json({
          success: true,
          mode: 'created',
          contactId: created?.contact?.id,
          email,
          listId,
        });
      }

      return res.status(200).json({ success: true, action, email: contact.email, listId });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
