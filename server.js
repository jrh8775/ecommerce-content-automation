const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
const dotenv = require('dotenv');
const { google } = require('googleapis');
const OpenAI = require('openai');

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
    console.error(`Error generating ${contentType}:`, error);
    throw error;
  }
}

// Generate all content for a product
async function generateAllContent(productData) {
  console.log(`Processing product: ${productData.name}`);
  
  try {
    const [title, bulletPoints, aContent, adCopy] = await Promise.all([
      generateContent('title', productData),
      generateContent('bulletPoints', productData),
      generateContent('aContent', productData),
      generateContent('adCopy', productData),
    ]);
    
    return {
      sku: productData.sku,
      productName: productData.name,
      generatedTitle: title,
      generatedBulletPoints: bulletPoints,
      generatedAContent: aContent,
      generatedAdCopy: adCopy,
      timestamp: new Date().toISOString(),
      status: 'success',
    };
  } catch (error) {
    return {
      sku: productData.sku,
      productName: productData.name,
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// Read from spreadsheet
async function readFromSpreadsheet(spreadsheetId, range) {
  try {
    const authClient = await auth.getClient();
    const response = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId,
      range,
    });
    return response.data.values || [];
  } catch (error) {
    console.error('Error reading spreadsheet:', error);
    throw error;
  }
}

// Write to spreadsheet
async function writeToSpreadsheet(spreadsheetId, range, values) {
  try {
    const authClient = await auth.getClient();
    await sheets.spreadsheets.values.update({
      auth: authClient,
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: { values },
    });
  } catch (error) {
    console.error('Error writing to spreadsheet:', error);
    throw error;
  }
}

// API Endpoint: Process new products
app.post('/api/process-products', async (req, res) => {
  try {
    const { spreadsheetId, inputRange, outputRange, clientId } = req.body;
    
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'spreadsheetId is required' });
    }
    
    // Read input data
    const rows = await readFromSpreadsheet(spreadsheetId, inputRange);
    
    if (!rows || rows.length === 0) {
      return res.json({ message: 'No new products to process', processed: 0 });
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
        audience: row[5] || '',
        useCase: row[6] || '',
      };
      
      const generatedContent = await generateAllContent(productData);
      results.push(generatedContent);
    }
    
    // Prepare output
    const outputValues = [
      ['SKU', 'Product Name', 'Generated Title', 'Bullet Points', 'A+ Content', 'Ad Copy', 'Status', 'Timestamp'],
      ...results.map(r => [
        r.sku,
        r.productName,
        r.generatedTitle || '',
        r.generatedBulletPoints || '',
        r.generatedAContent || '',
        r.generatedAdCopy || '',
        r.status,
        r.timestamp,
      ]),
    ];
    
    // Write results back to spreadsheet
    await writeToSpreadsheet(spreadsheetId, outputRange, outputValues);
    
    res.json({
      message: 'Products processed successfully',
      processed: results.length,
      results: results.map(r => ({
        sku: r.sku,
        status: r.status,
        error: r.error || null,
      })),
    });
  } catch (error) {
    console.error('Error in process-products:', error);
    res.status(500).json({ error: error.message });
  }
});

// API Endpoint: Process single product
app.post('/api/generate-content', async (req, res) => {
  try {
    const productData = req.body;
    
    if (!productData.name || !productData.category) {
      return res.status(400).json({ error: 'name and category are required' });
    }
    
    const result = await generateAllContent(productData);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'E-commerce Content Automation API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      generateContent: 'POST /api/generate-content',
      processProducts: 'POST /api/process-products',
    },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
