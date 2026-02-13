import { config } from 'dotenv';

// Load environment variables
config();

interface Config {
  port: number;
  nodeEnv: string;

  // Supabase
  supabaseUrl: string;
  supabaseServiceKey: string;

  // Google Ads
  googleClientId: string;
  googleClientSecret: string;
  googleCustomerId: string;
  googleDeveloperToken: string;
  googleConversionActionId: string;

  // Meta Ads
  metaAppId: string;
  metaAppSecret: string;
  metaAdAccountId: string;

  // Authentication
  etlApiKey: string;

  // Logging
  logLevel: string;
}

const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CUSTOMER_ID',
  'GOOGLE_DEVELOPER_TOKEN',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_AD_ACCOUNT_ID',
  'ETL_API_KEY'
];

// Validate required environment variables
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

export const appConfig: Config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Supabase
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
  
  // Google Ads
  googleClientId: process.env.GOOGLE_CLIENT_ID!,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  googleCustomerId: process.env.GOOGLE_CUSTOMER_ID!,
  googleDeveloperToken: process.env.GOOGLE_DEVELOPER_TOKEN!,
  googleConversionActionId: process.env.GOOGLE_CONVERSION_ACTION_ID || '',
  
  // Meta Ads
  metaAppId: process.env.META_APP_ID!,
  metaAppSecret: process.env.META_APP_SECRET!,
  metaAdAccountId: process.env.META_AD_ACCOUNT_ID!,
  
  // Authentication
  etlApiKey: process.env.ETL_API_KEY!,
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info'
};

export default appConfig;