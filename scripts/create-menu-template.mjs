import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SpreadsheetFile, Workbook } = require('@oai/artifact-tool');

const workbook = Workbook.create();
const sheet = workbook.worksheets.add('Menu Items');
sheet.showGridLines = false;

const headers = [
  'name_en',
  'name_de',
  'description_en',
  'description_de',
  'category',
  'price',
  'badge_en',
  'badge_de',
  'available',
  'sort_order',
  'image_style',
];

const rows = [
  ['Berry Cloud Pancakes', 'Berry Cloud Pancakes', 'Mini pancakes, strawberry cream, berries, and white chocolate.', 'Mini-Pancakes, Erdbeercreme, Beeren und weisse Schokolade.', 'Signature Bowls', 8.5, 'Popular', 'Beliebt', 'TRUE', 1, 'berry'],
  ['Rose Milk Cooler', 'Rosenmilch Cooler', 'Iced milk, rose syrup, basil seeds, and cream foam.', 'Eismilch, Rosensirup, Basilikumsamen und Cremeschaum.', 'Drinks', 4.5, '', '', 'TRUE', 2, 'drink-pink'],
];

sheet.getRange('A1:K1').values = [headers];
sheet.getRange('A2:K3').values = rows;
sheet.getRange('A1:K1').format = {
  fill: '#211B33',
  font: { name: 'Arial', bold: true, color: '#FFFFFF', size: 10 },
};
sheet.getRange('A2:K20').format.font = { name: 'Arial', size: 10 };
sheet.getRange('A1:K20').format.borders = { preset: 'all', style: 'thin', color: '#E6DFF0' };
sheet.getRange('F2:F20').format.numberFormat = '0.00';
sheet.getRange('J2:J20').format.numberFormat = '0';
sheet.freezePanes.freezeRows(1);
sheet.tables.add('A1:K20', true, 'MenuItemsTemplate');
sheet.getRange('A:K').format.autofitColumns();

const notes = workbook.worksheets.add('Instructions');
notes.showGridLines = false;
notes.getRange('A1').values = [['Menu upload template']];
notes.getRange('A3:A9').values = [
  ['Fill one menu item per row in the Menu Items sheet.'],
  ['Required fields: name_en, category, price.'],
  ['available accepts TRUE or FALSE.'],
  ['category can be an existing category or a new one.'],
  ['image_style examples: berry, lavender, pink, caramel, mochi, drink-pink, matcha, green, combo.'],
  ['Upload this .xlsx file from Owner/Admin > Manage items.'],
  ['Do not rename the Menu Items sheet or header row.'],
];
notes.getRange('A1').format.font = { name: 'Arial', bold: true, size: 14, color: '#211B33' };
notes.getRange('A3:A9').format.font = { name: 'Arial', size: 10, color: '#5E5368' };
notes.getRange('A:A').format.columnWidth = 95;

workbook.recalculate();
await workbook.inspect({ kind: 'sheet', include: 'name' });
await workbook.render({ sheetName: 'Menu Items', range: 'A1:K6', scale: 1, format: 'png' });

await fs.mkdir('public', { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save('public/menu-items-template.xlsx');
