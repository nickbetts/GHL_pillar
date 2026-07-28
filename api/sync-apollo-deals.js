/**
 * Sync Apollo List Contacts → GHL Contacts
 * Pulls contacts from a configured Apollo list and creates/updates them in GHL.
 */

import { get, post, put } from '../client.js';
import {
  getContactsFromList,
  enrichContactData,
} from './apollo-client.js';

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const APOLLO_LIST_ID = process.env.APOLLO_LIST_ID;

class ApolloDealSyncer {
  constructor() {
    this.stats = {
      contactsProcessed: 0,
      contactsCreated: 0,
      contactsUpdated: 0,
      errors: [],
    };
    this.ghlContactsByEmail = new Map();
  }

  /**
   * Main sync orchestrator
   */
  async sync() {
    console.log('🚀 Starting Apollo list → GHL contact sync...');

    try {
      await this.loadGHLContacts();

      const apolloContacts = await this.fetchApolloContacts();
      console.log(`📋 Fetched ${apolloContacts.length} contacts from Apollo list`);

      for (const contact of apolloContacts) {
        await this.processContact(contact);
      }

      return this.getResults();
    } catch (error) {
      console.error('❌ Sync failed:', error.message);
      this.stats.errors.push(error.message);
      return this.getResults();
    }
  }

  /**
   * Load all GHL contacts into memory for deduplication
   */
  async loadGHLContacts() {
    console.log('📥 Loading GHL contacts for deduplication...');
    try {
      // Note: GHL API doesn't have bulk contact fetch, so we'll rely on email lookup
      // In production, you'd cache this or use their bulk export
      console.log('✅ Ready for email-based deduplication');
    } catch (error) {
      console.warn('⚠️ Failed to preload contacts:', error.message);
    }
  }

  /**
   * Fetch deals from Apollo with date filter
   */
  async fetchApolloContacts() {
    if (!APOLLO_LIST_ID) {
      const message = 'APOLLO_LIST_ID is not configured; skipping list sync';
      console.warn(`⚠️ ${message}`);
      this.stats.errors.push(message);
      return [];
    }

    return getContactsFromList(APOLLO_LIST_ID);
  }

  /**
   * Process a single Apollo contact
   */
  async processContact(apolloContact) {
    try {
      const email = apolloContact?.email || apolloContact?.contact?.email;
      if (!email) {
        this.stats.errors.push('Apollo contact missing email');
        return;
      }

      this.stats.contactsProcessed++;
      const ghlContactId = await this.findOrCreateContact(apolloContact);
      if (!ghlContactId) {
        this.stats.errors.push(`Failed to sync contact ${email}`);
      }
    } catch (error) {
      this.stats.errors.push(`Contact ${apolloContact?.email || 'unknown'}: ${error.message}`);
    }
  }

  /**
   * Find or create contact in GHL
   */
  async findOrCreateContact(apolloContact) {
    const email = apolloContact?.email || apolloContact?.contact?.email;
    if (!email) return null;

    try {
      const existing = await get(`/contacts/${email}`, { locationId: LOCATION_ID });
      if (existing?.contact?.id) {
        await this.updateContact(existing.contact.id, apolloContact);
        this.stats.contactsUpdated++;
        return existing.contact.id;
      }
    } catch (error) {
      // Contact not found, will create new one
    }

    try {
      const contactData = enrichContactData(apolloContact);
      const response = await post('/contacts/', {
        locationId: LOCATION_ID,
        ...contactData,
      });
      this.stats.contactsCreated++;
      return response?.contact?.id;
    } catch (error) {
      console.error(`Failed to create contact for ${email}:`, error.message);
      return null;
    }
  }

  /**
   * Update existing contact with Apollo data
   */
  async updateContact(contactId, apolloDeal) {
    try {
      const contactData = enrichContactData(apolloDeal);
      await put(`/contacts/${contactId}`, {
        locationId: LOCATION_ID,
        ...contactData,
      });
    } catch (error) {
      console.warn(`Failed to update contact ${contactId}:`, error.message);
    }
  }

  /**
   * Get sync results summary
   */
  getResults() {
    return {
      success: this.stats.errors.length === 0,
      timestamp: new Date().toISOString(),
      stats: this.stats,
      summary: `Processed ${this.stats.contactsProcessed} Apollo contacts → ${this.stats.contactsCreated} new contacts, ${this.stats.contactsUpdated} updated`,
    };
  }
}

export async function syncApolloDeals() {
  const syncer = new ApolloDealSyncer();
  return syncer.sync();
}

export { ApolloDealSyncer };
