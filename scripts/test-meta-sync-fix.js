require('dotenv').config();
const { IncrementalSyncManager } = require('../dist/loaders/incremental-sync');

async function testMetaSyncFix() {
  try {
    console.log('🧪 Testing Meta ETL sync status fix...');
    
    const syncManager = new IncrementalSyncManager();
    
    console.log('🚀 Starting Meta insights sync...');
    const result = await syncManager.performIncrementalSync('meta', 'insights', {
      startDate: '2025-08-21',
      endDate: '2025-08-22'
    });
    
    console.log('✅ Meta sync completed!');
    console.log('📊 Sync Results:', {
      batchId: result.batchId,
      platform: result.platform,
      entityType: result.entityType,
      recordsProcessed: result.recordsProcessed,
      recordsInserted: result.recordsInserted,
      recordsUpdated: result.recordsUpdated,
      recordsFailed: result.recordsFailed,
      status: result.status,
      duration: `${result.duration}ms`
    });
    
    if (result.batchId) {
      console.log('\n🔍 Checking sync batch status in database...');
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );
      
      const { data: batchData, error } = await supabase
        .schema('marketing')
        .from('etl_sync_log')
        .select('*')
        .eq('id', result.batchId)
        .single();
        
      if (error) {
        console.error('❌ Failed to fetch batch data:', error.message);
      } else {
        console.log('📋 Database Batch Record:', {
          id: batchData.id,
          platform: batchData.platform,
          entity_type: batchData.entity_type,
          status: batchData.status,
          records_processed: batchData.records_processed,
          records_inserted: batchData.records_inserted,
          records_updated: batchData.records_updated,
          records_failed: batchData.records_failed,
          start_time: batchData.start_time,
          end_time: batchData.end_time
        });
        
        if (batchData.status === 'completed' && batchData.records_processed > 0) {
          console.log('🎉 SUCCESS: Sync status properly updated to completed with record count!');
        } else {
          console.log('❌ ISSUE: Sync status or record count not properly updated');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testMetaSyncFix();