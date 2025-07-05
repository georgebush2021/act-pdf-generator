const puppeteer = require('puppeteer');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const payload = req.body;
// testing puppetteer
    const templatePath = path.join(__dirname, '..', 'template.ejs');
    const template = fs.readFileSync(templatePath, 'utf-8');

    const html = ejs.render(template, {
      ...payload,
      successDriversLogo: 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'success_drivers.png')).toString('base64'),
      actLogo: 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'act.png')).toString('base64'),
      chartScript: '',
      radarChartScript: ''
    });

    // const browser = await puppeteer.launch({
    //   args: chromium.args,
    //   executablePath: await chromium.executablePath,
    //   headless: chromium.headless
    // });
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
     res.setHeader('Content-Disposition', 'inline; filename=report.pdf');
    res.end(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('PDF generation failed.');
  }
};
