const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { google } = require('googleapis');
const OpenAI = require('openai');
const {
  ValidationError,
  QuotaError,
  GoogleSheetsError,
  OpenAIError,
  validateProductData,
  validateSpreadsheetParams,
  errorHandler,
} = require('./error-handler');

dotenv.config();

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Initialize clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || './credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Content Generation Prompts
const PROMPTS = {
  title: (productData) => `
Generate an SEO-optimized Amazon product title (max 60 characters) for:
Product: ${productData.name}
Category: ${productData.category}
Key Features: ${productData.features}

Requirements:
- Include main keyword
- Include key feature/benefit
- Professional, scannable
- NO ALL CAPS, NO special characters except -

Return ONLY the title, nothing else.
  `,
  
  bulletPoints: (productData) => `
Create 5 compelling bullet points for an Amazon listing:
Product: ${productData.name}
Category: ${productData.category}
Features: ${productData.features}
Price: $${productData.price}
Target Audience: ${productData.audience || 'General'}

Requirements:
- Start each with a benefit/feature
- Use power words (premium, advanced, efficient, etc.)
- Include specific details when possible
- 85 characters max per bullet
- One should mention value/price relationship

Format as numbered list.
  `,
  
  aContent: (productData) => `
Create an Amazon A+ Content (Enhanced Brand Content) for:
Product: ${productData.name}
Category: ${productData.category}
Features: ${productData.features}
Target Use Case: ${productData.useCase || 'Not specified'}

Provide 3 sections:

1. **Overview Section**: 1-2 sentences explaining main benefit
2. **Comparison Section**: How this product solves customer pain points (3-4 points)
3. **Value Proposition**: Why choose this product (2-3 key differentiators)

Use markdown formatting.
  `,
  
  adCopy: (productData) => `
Create 3 different ad copy variations for:
Product: ${productData.name}
Features: ${productData.features}
Price: $${productData.price}
Target: ${productData.audience || 'General audience'}

Requirements:
- Variation 1: Benefit-focused (for social media)
- Variation 2: Problem-solution focused (for email)
- Variation 3: Urgency/value focused (for display ads)
- Each 2-3 sentences max
- Include call-to-action

Label each variation clearly.
  `,
};

// Generate content using OpenAI
async function generateContent(contentType, productData) {
  try {
    const prompt = PROMPTS[contentType](productData);
    
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert e-commerce copywriter specializing in product descriptions. Be concise, compelling, and SEO-aware.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    // Handle OpenAI specific errors
    if (error.status === 429) {
      throw new QuotaError();
    }
    if (error.status === 401) {
      throw new OpenAIError('Invalid OpenAI API key', 401);
    }
    throw new OpenAIError(`Failed to generate ${contentType}: ${error.message}`);
  }
}

// Generate all content types for a product
async function generateAllContent(productData) {
  try {
    validateProductData(productData);
    
    const contentTypes = ['title', 'bulletPoints', 'aContent', 'adCopy'];
    const results = {};
    const errors = [];

    for (const contentType of contentTypes) {
      try {
        results[contentType] = await generateContent(contentType, productData);
      } catch (error) {
        errors.push({
          contentType,
          error: error.message,
        });
      }
    }

    return {
      productName: productData.name,
      status: errors.length === 0 ? 'success' : 'partial_success',
      data: results,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw error;
  }
}

// Read from Google Sheets
async function readFromSpreadsheet(spreadsheetId, range) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range,
    });
    return response.data.values || [];
  } catch (error) {
    throw new GoogleSheetsError(`Failed to read spreadsheet: ${error.message}`);
  }
}

// Write to Google Sheets
async function writeToSpreadsheet(spreadsheetId, range, values) {
  try {
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });
  } catch (error) {
    throw new GoogleSheetsError(`Failed to write to spreadsheet: ${error.message}`);
  }
}

// API Endpoints

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Process products from Google Sheets
app.post('/api/process-products', async (req, res, next) => {
  try {
    const { spreadsheetId, inputRange, outputRange } = req.body;

    validateSpreadsheetParams({ spreadsheetId, inputRange, outputRange });

    // Read input data
    const rows = await readFromSpreadsheet(spreadsheetId, inputRange);

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        error: 'No data found in the specified range',
        code: 'NO_DATA',
        timestamp: new Date().toISOString(),
      });
    }

    // Skip header row
    const productRows = rows.slice(1);
    const results = [];

    // Process each product
    for (const row of productRows) {
      const productData = {
        sku: row[0],
        name: row[1],
        category: row[2],
        features: row[3],
        price: row[4],
        audience: row[5],
        useCase: row[6],
      };

      const result = await generateAllContent(productData);
      results.push(result);
    }

    // Prepare output data
    const outputData = results.map((result) => [
      result.productName,
      result.data.title || '',
      result.data.bulletPoints || '',
      result.data.aContent || '',
      result.data.adCopy || '',
      result.status,
      result.errors ? JSON.stringify(result.errors) : '',
    ]);

    // Add header
    outputData.unshift([
      'Product Name',
      'Title',
      'Bullet Points',
      'A+ Content',
      'Ad Copy',
      'Status',
      'Errors',
    ]);

    // Write to spreadsheet
    await writeToSpreadsheet(spreadsheetId, outputRange, outputData);

    res.json({
      message: 'Products processed successfully',
      processed: productRows.length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// Generate content for single product
app.post('/api/generate-content', async (req, res, next) => {
  try {
    const productData = req.body;

    validateProductData(productData);

    const result = await generateAllContent(productData);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// API Documentation
app.get('/', (req, res) => {
  res.json({
    name: 'E-Commerce Content Automation API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      generateContent: 'POST /api/generate-content',
      processProducts: 'POST /api/process-products',
    },
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.path,
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
