require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function cleanupHangingSyncs() {
  try {
    console.log('🔍 Checking for hanging sync records...');
    
    // Find all sync records that are still "running" and older than 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    const { data: hangingSyncs, error } = await supabase
      .schema('marketing')
      .from('etl_sync_log')
      .select('*')
      .eq('status', 'running')
      .lt('start_time', twoHoursAgo)
      .order('start_time', { ascending: false });

    if (error) {
      throw new Error(`Failed to query hanging syncs: ${error.message}`);
    }

    console.log(`📊 Found ${hangingSyncs.length} hanging sync records`);
    
    if (hangingSyncs.length === 0) {
      console.log('✅ No hanging sync records found');
      return;
    }

    // Show details of hanging syncs
    console.log('\n🔍 Hanging sync details:');
    hangingSyncs.forEach((sync, index) => {
      console.log(`${index + 1}. ID: ${sync.id} | Platform: ${sync.platform} | Entity: ${sync.entity_type} | Started: ${sync.start_time}`);
    });

    // Ask for confirmation (in script context, we'll auto-confirm)
    console.log('\n🛠️  Updating hanging syncs to "failed" status...');
    
    const hangingIds = hangingSyncs.map(sync => sync.id);
    
    const { error: updateError } = await supabase
      .schema('marketing')
      .from('etl_sync_log')
      .update({
        status: 'failed',
        end_time: new Date().toISOString(),
        error_message: 'Cleaned up hanging sync record - process likely crashed or timed out'
      })
      .in('id', hangingIds);

    if (updateError) {
      throw new Error(`Failed to update hanging syncs: ${updateError.message}`);
    }

    console.log(`✅ Successfully updated ${hangingSyncs.length} hanging sync records to "failed" status`);
    
    // Show updated counts
    const { data: currentRunning, error: countError } = await supabase
      .schema('marketing')
      .from('etl_sync_log')
      .select('id')
      .eq('status', 'running');

    if (!countError) {
      console.log(`📊 Remaining "running" sync records: ${currentRunning.length}`);
    }

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    process.exit(1);
  }
}

cleanupHangingSyncs();