import express from 'express';
import bodyParser from 'body-parser';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import Handlebars from 'handlebars';
import ejs from "ejs";
import { generateChartScript, generateRadarChartScript } from './src/lib.ts';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(process.cwd(), './public'))); // If you have static assets

// Register a helper for Chart.js script injection
Handlebars.registerHelper('json', function (context) {
    return JSON.stringify(context);
});

// Register a helper to safely output unescaped content
Handlebars.registerHelper('safe', function (text) {
    return new Handlebars.SafeString(text);
});

app.post('/api/generate-pdf', async (req, res) => {
    const { fileName, data, reportTitle, strengths, weaknesses, annexureData, respondentSummary } = req.body;

    if (!fileName || !data) {
        res.status(400).send('Missing fileName or data in request body.');
        return
    }

    try {
        // Read HTML template
        const templatePath = path.join(process.cwd(), './src/app/api/generate-pdf/template.ejs');
        const htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        // Read and encode logo files to base64
        const successDriversLogoPath = path.join(process.cwd(), './success_drivers.png');
        const actLogoPath = path.join(process.cwd(), './act.png');

        const successDriversLogo = `data:image/png;base64,${fs.readFileSync(successDriversLogoPath).toString('base64')}`;
        const actLogo = `data:image/png;base64,${fs.readFileSync(actLogoPath).toString('base64')}`;

        // Compile Handlebars template
        const template = Handlebars.compile(htmlTemplate);

        // Generate chart scripts dynamically
        let chartScript = '';
        for (const competencyName in data) {
            if (data.hasOwnProperty(competencyName) && data[competencyName].metrics) {
                // Add each chart with a line break between them
                chartScript += generateChartScript(competencyName, data[competencyName].metrics);
            }
        }

        const personName = fileName.split('_')[0];

        const formattedStrengths = strengths.map((s: { description: string, overall_score: number }) => ({
            ...s,
            overall_score: s.overall_score.toFixed(2) // Format score to 2 decimal places
        }));

        const formattedWeaknesses = weaknesses.map((w: { description: string, overall_score: number }) => ({
            ...w,
            overall_score: w.overall_score.toFixed(2) // Format score to 2 decimal places
        }));

        const radarChartScript = generateRadarChartScript(data);

        // Ensure chartScript is properly inserted as valid JavaScript
        const htmlData = {
            personName: personName, // Add extracted name
            fileName: fileName,
            reportTitle,
            data: data,
            strengths: formattedStrengths,
            weaknesses: formattedWeaknesses,
            annexureData: annexureData, // Add annexure data
            chartScript: chartScript, // Mark as safe string to prevent HTML encoding
            successDriversLogo, // Add success drivers logo
            actLogo, // Add act logo
            radarChartScript,
            respondentSummary
        };

        // Render HTML
        const renderedHtml = await ejs.render(htmlTemplate, htmlData);

        const header = ` <div style="margin-left-auto;padding:0; width:100%;display:flex;justify-content:end;">
            <img src="${actLogo}" alt="ACT Logo" class="logo" style="max-height: 8mm;width: auto; mix-blend-mode: multiply;margin:2mm 6mm;" />
        </div>`

        // save this rendered HTML to a file for debugging purposes
        const debugHtmlPath = path.join(process.cwd(), 'debug', `${fileName}_debug.html`);
        const debugDir = path.dirname(debugHtmlPath);
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, { recursive: true });
        }
        fs.writeFileSync(debugHtmlPath, renderedHtml);
        console.log(`Debug HTML saved to: ${debugHtmlPath}`);

        // Launch Puppeteer
        const browser = await puppeteer.launch({
            headless: true, // Use 'new' for latest headless mode, true is deprecated
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'], // Added font hinting for potential sharpness
        });

        const page = await browser.newPage();

        // Set content and wait for network idle to ensure charts are rendered
        await page.setContent(renderedHtml, { waitUntil: 'networkidle0' });

        // Wait additional time to ensure charts are fully rendered
        await page.waitForNetworkIdle()

        // Generate PDF with better page break handling
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: header,
            footerTemplate: `<span></span>`,
            margin: {
                top: '1.45in',
                right: '0.31in',
                bottom: '0.47in',
                left: '0.31in'
            }
        });

        await browser.close();

        // Save PDF to file system (optional, for server-side persistence)
        const pdfOutputFileName = `${fileName}_Performance_Report.pdf`;
        const outputPath = path.join(process.cwd(), 'generated_pdfs', pdfOutputFileName);
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Check if file exists and delete it before creating new one
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath); // Delete existing file
            console.log(`Existing file deleted: ${outputPath}`);
        }

        fs.writeFileSync(outputPath, pdfBuffer);
        console.log(`PDF saved to: ${outputPath}`);

        // Send PDF back in response
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).send('Failed to generate PDF report.');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// grafully shutdown the server on SIGINT
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    process.exit(0);
});