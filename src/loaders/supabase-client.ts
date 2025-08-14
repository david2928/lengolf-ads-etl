import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';

export class SupabaseLoader {
  private client: SupabaseClient;

  constructor() {
    this.client = createClient(appConfig.supabaseUrl, appConfig.supabaseServiceKey);
  }

  async testConnection(): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .schema('marketing')
        .from('etl_sync_log')
        .select('id')
        .limit(1);

      if (error) {
        logger.error('Supabase connection test failed', { error: error.message });
        return false;
      }

      logger.info('Supabase connection test successful');
      return true;

    } catch (error) {
      logger.error('Supabase connection error', { error: error.message });
      return false;
    }
  }

  async createSyncBatch(
    platform: string,
    syncType: string,
    entities: string[]
  ): Promise<string> {
    try {
      const { data, error } = await this.client
        .schema('marketing')
        .from('etl_sync_log')
        .insert({
          platform,
          entity_type: entities.join(','),
          sync_type: syncType,
          start_time: new Date().toISOString(),
          status: 'running',
          records_processed: 0,
          records_inserted: 0,
          records_updated: 0,
          records_failed: 0
        })
        .select('id')
        .single();

      if (error) {
        logger.error('Failed to create sync batch', { error: error.message });
        throw new Error(`Failed to create sync batch: ${error.message}`);
      }

      logger.info('Sync batch created', { batchId: data.id, platform, syncType });
      return data.id;

    } catch (error) {
      logger.error('Create sync batch error', { error: error.message });
      throw error;
    }
  }

  async updateSyncBatch(
    batchId: string,
    updates: {
      status?: string;
      records_processed?: number;
      records_inserted?: number;
      records_updated?: number;
      records_failed?: number;
      error_message?: string;
      end_time?: string;
    }
  ): Promise<void> {
    try {
      const { error } = await this.client
        .schema('marketing')
        .from('etl_sync_log')
        .update({
          ...updates,
          end_time: updates.end_time || new Date().toISOString()
        })
        .eq('id', batchId);

      if (error) {
        logger.error('Failed to update sync batch', { 
          batchId, 
          error: error.message 
        });
        throw new Error(`Failed to update sync batch: ${error.message}`);
      }

      logger.debug('Sync batch updated', { batchId, updates });

    } catch (error) {
      logger.error('Update sync batch error', { error: error.message });
      throw error;
    }
  }

  async getLastSyncState(platform: string, entityType: string): Promise<any> {
    try {
      const { data, error } = await this.client
        .schema('marketing')
        .from('etl_sync_log')
        .select('*')
        .eq('platform', platform)
        .eq('entity_type', entityType)
        .eq('status', 'completed')
        .order('end_time', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        logger.error('Failed to get last sync state', { 
          platform,
          entityType,
          error: error.message 
        });
        throw new Error(`Failed to get last sync state: ${error.message}`);
      }

      return data || {
        platform,
        entity_type: entityType,
        last_sync_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
        last_modified_time: null,
        next_page_token: null
      };

    } catch (error) {
      logger.error('Get last sync state error', { error: error.message });
      throw error;
    }
  }

  async bulkUpsert(
    tableName: string,
    data: any[],
    conflictColumns: string | string[] = 'id'
  ): Promise<{ inserted: number; updated: number }> {
    if (!data.length) {
      return { inserted: 0, updated: 0 };
    }

    try {
      logger.info(`Starting bulk upsert to ${tableName}`, {
        recordCount: data.length,
        conflictColumns
      });

      const { data: result, error } = await this.client
        .schema('marketing')
        .from(tableName)
        .upsert(data, {
          onConflict: Array.isArray(conflictColumns) 
            ? conflictColumns.join(',') 
            : conflictColumns,
          ignoreDuplicates: false
        })
        .select('*');

      if (error) {
        logger.error(`Bulk upsert failed for ${tableName}`, {
          error: error.message,
          code: error.code,
          details: error.details
        });
        throw new Error(`Bulk upsert failed for ${tableName}: ${error.message}`);
      }

      const resultCount = result?.length || 0;
      
      logger.info(`Bulk upsert completed for ${tableName}`, {
        recordsProcessed: data.length,
        recordsReturned: resultCount
      });

      // Note: Supabase doesn't distinguish between inserts and updates
      // We return the total count as inserted for simplicity
      return {
        inserted: resultCount,
        updated: 0
      };

    } catch (error) {
      logger.error(`Bulk upsert error for ${tableName}`, { error: error.message });
      throw error;
    }
  }

  async bulkInsert(tableName: string, data: any[]): Promise<number> {
    if (!data.length) {
      return 0;
    }

    try {
      logger.info(`Starting bulk insert to ${tableName}`, {
        recordCount: data.length
      });

      const { data: result, error } = await this.client
        .schema('marketing')
        .from(tableName)
        .insert(data)
        .select('*');

      if (error) {
        logger.error(`Bulk insert failed for ${tableName}`, {
          error: error.message,
          code: error.code
        });
        throw new Error(`Bulk insert failed for ${tableName}: ${error.message}`);
      }

      const insertedCount = result?.length || 0;
      
      logger.info(`Bulk insert completed for ${tableName}`, {
        recordsInserted: insertedCount
      });

      return insertedCount;

    } catch (error) {
      logger.error(`Bulk insert error for ${tableName}`, { error: error.message });
      throw error;
    }
  }

  async executeQuery(query: string, params?: any[]): Promise<any> {
    try {
      const { data, error } = await this.client.rpc('execute_sql', {
        sql_query: query,
        query_params: params || []
      });

      if (error) {
        logger.error('SQL query execution failed', {
          error: error.message,
          query: query.substring(0, 100) + '...'
        });
        throw new Error(`SQL query failed: ${error.message}`);
      }

      return data;

    } catch (error) {
      logger.error('Execute query error', { error: error.message });
      throw error;
    }
  }

  async getTableInfo(tableName: string): Promise<any> {
    try {
      const { data, error } = await this.client
        .from('information_schema.tables')
        .select('*')
        .eq('table_name', tableName)
        .eq('table_schema', 'marketing')
        .single();

      if (error) {
        logger.error(`Failed to get table info for ${tableName}`, {
          error: error.message
        });
        return null;
      }

      return data;

    } catch (error) {
      logger.error('Get table info error', { error: error.message });
      return null;
    }
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}

export default SupabaseLoader;