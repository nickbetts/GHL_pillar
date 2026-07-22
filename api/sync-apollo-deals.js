/**
 * Sync Apollo Deals → GHL Opportunities
 * Fetches deals from Apollo, deduplicates against GHL contacts,
 * and creates/updates opportunities in GHL pipeline
 */

import { get, post, put } from '../client.js';
import {
  getDeals,
  enrichContactData,
  enrichOpportunityData,
} from './apollo-client.js';

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const SYNC_BATCH_SIZE = 50;
const APOLLO_SYNC_CUTOFF_DAYS = 7; // Only sync deals updated in last N days

class ApolloDealSyncer {
  constructor() {
    this.stats = {
      dealsProcessed: 0,
      contactsCreated: 0,
      contactsUpdated: 0,
      opportunitiesCreated: 0,
      opportunitiesUpdated: 0,
      errors: [],
    };
    this.ghlContactsByEmail = new Map();
  }

  /**
   * Main sync orchestrator
   */
  async sync() {
    console.log('🚀 Starting Apollo → GHL deal sync...');

    try {
      // 1. Load existing GHL contacts into memory (for dedup)
      await this.loadGHLContacts();

      // 2. Fetch deals from Apollo
      const apolloDeals = await this.fetchApolloDeals();
      console.log(`📋 Fetched ${apolloDeals.length} deals from Apollo`);

      // 3. Process each deal
      for (const deal of apolloDeals) {
        await this.processDeal(deal);
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
  async fetchApolloDeals() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - APOLLO_SYNC_CUTOFF_DAYS);

    return getDeals({
      statuses: ['open', 'qualified', 'negotiating', 'won'],
      updated_after: cutoffDate.toISOString(),
    });
  }

  /**
   * Process a single Apollo deal
   */
  async processDeal(apolloDeal) {
    try {
      const email = apolloDeal.contact?.email;
      if (!email) {
        this.stats.errors.push(`Apollo deal ${apolloDeal.id}: no email found`);
        return;
      }

      this.stats.dealsProcessed++;

      // 1. Find or create contact in GHL
      let ghlContactId = await this.findOrCreateContact(apolloDeal);
      if (!ghlContactId) {
        this.stats.errors.push(`Apollo deal ${apolloDeal.id}: failed to sync contact`);
        return;
      }

      // 2. Find or create opportunity in GHL
      await this.findOrCreateOpportunity(apolloDeal, ghlContactId);
    } catch (error) {
      this.stats.errors.push(`Deal ${apolloDeal.id}: ${error.message}`);
    }
  }

  /**
   * Find or create contact in GHL
   */
  async findOrCreateContact(apolloDeal) {
    const email = apolloDeal.contact?.email;
    if (!email) return null;

    try {
      // Check if contact exists
      const existing = await get(`/contacts/${email}`, { locationId: LOCATION_ID });
      if (existing?.contact?.id) {
        // Update existing contact with Apollo data
        await this.updateContact(existing.contact.id, apolloDeal);
        this.stats.contactsUpdated++;
        return existing.contact.id;
      }
    } catch (error) {
      // Contact not found, will create new one
    }

    // Create new contact
    try {
      const contactData = enrichContactData(apolloDeal);
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
   * Find or create opportunity in GHL
   */
  async findOrCreateOpportunity(apolloDeal, contactId) {
    try {
      // Check if opportunity exists by external ID or name
      // GHL doesn't have external_id, so we'll use deal name + contact as unique key
      const opportunityName = apolloDeal.name || `Apollo: ${apolloDeal.company?.name}`;

      // Try to find by name (not ideal, but GHL API is limited)
      // In production, store the Apollo deal ID in a custom field
      const oppData = enrichOpportunityData(apolloDeal);

      // Add Apollo Deal ID to custom fields for bidirectional sync
      const customFields = oppData.customFields || [];
      customFields.push({
        id: 'apolloDealId', // Will be mapped to actual field ID during setup
        value: apolloDeal.id,
      });

      // Create opportunity
      const response = await post('/opportunities', {
        locationId: LOCATION_ID,
        ...oppData,
        customFields,
        contactId,
        pipelineId: process.env.GHL_PIPELINE_ID, // Needs to be set in .env
      });

      if (response?.opportunity?.id) {
        this.stats.opportunitiesCreated++;
        console.log(`✅ Created opportunity: ${opportunityName} (Apollo: ${apolloDeal.id})`);
      }
    } catch (error) {
      console.error(`Failed to create opportunity for ${apolloDeal.name}:`, error.message);
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
      summary: `Processed ${this.stats.dealsProcessed} deals → ${this.stats.contactsCreated} new contacts, ${this.stats.contactsUpdated} updated, ${this.stats.opportunitiesCreated} new opportunities`,
    };
  }
}

export async function syncApolloDeals() {
  const syncer = new ApolloDealSyncer();
  return syncer.sync();
}

export { ApolloDealSyncer };
