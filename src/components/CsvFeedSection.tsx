import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { apiRequest, formatDateTime, formatNumber } from '../lib/api';
import { CsvImportResult, ImportBatch } from '../types';

interface CsvFeedSectionProps {
  companyId: string;
  companyName: string;
  canWrite: boolean;
  recentImports: ImportBatch[];
  onImportSuccess: () => void;
}

const TARGET_FIELDS = [
  { key: 'sku', label: 'SKU (Required)', aliases: ['sku', 'itemcode', 'code', 'partnumber', 'productid'] },
  { key: 'name', label: 'Item Name (Required)', aliases: ['name', 'itemname', 'productname', 'title', 'description'] },
  { key: 'category', label: 'Category', aliases: ['category', 'group', 'department', 'type'] },
  { key: 'quantity', label: 'Quantity', aliases: ['quantity', 'qty', 'stock', 'onhand', 'count'] },
  { key: 'unit', label: 'Unit', aliases: ['unit', 'uom', 'measure'] },
  { key: 'unitPrice', label: 'Unit Price', aliases: ['unitprice', 'price', 'cost', 'rate', 'value'] },
  { key: 'reorderLevel', label: 'Reorder Level', aliases: ['reorderlevel', 'reorder', 'minstock', 'threshold', 'safetystock'] },
  { key: 'warehouse', label: 'Warehouse', aliases: ['warehouse', 'location', 'bin', 'facility', 'depot'] },
  { key: 'supplier', label: 'Supplier', aliases: ['supplier', 'vendor', 'manufacturer'] },
] as const;

function parseCsvLinePreview(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parsePreviewRows(csvText: string): { headers: string[]; rows: string[][] } {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLinePreview(lines[0]);
  const rows = lines.slice(1, 9).map(parseCsvLinePreview);
  return { headers, rows };
}

export function CsvFeedSection({
  companyId,
  companyName,
  canWrite,
  recentImports,
  onImportSuccess,
}: CsvFeedSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [filename, setFilename] = useState('');
  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState<'upsert' | 'skip'>('upsert');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);

  function loadCsvContent(name: string, text: string) {
    setError(null);
    setResult(null);
    const parsed = parsePreviewRows(text);
    if (parsed.headers.length === 0) {
      setError('Selected CSV file appears to be empty.');
      return;
    }

    const autoMap: Record<string, string> = {};
    for (const field of TARGET_FIELDS) {
      const match = parsed.headers.find((h) =>
        field.aliases.includes(h.toLowerCase().replace(/[\s_-]+/g, '') as never)
      );
      if (match) {
        autoMap[field.key] = match;
      }
    }

    setFilename(name);
    setCsvText(text);
    setHeaders(parsed.headers);
    setPreviewRows(parsed.rows);
    setColumnMap(autoMap);
  }

  function handleFileSelected(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setError('Please upload a valid .csv file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      loadCsvContent(file.name, String(reader.result || ''));
    };
    reader.onerror = () => {
      setError('Unable to read the selected CSV file.');
    };
    reader.readAsText(file);
  }

  function handleDownloadTemplate() {
    const sample = [
      'sku,name,category,quantity,unit,unit_price,reorder_level,warehouse,supplier',
      'SKU-1042,Industrial Servo Drive 750W,Motion Control,85,pcs,340.00,20,Main Hub,Siemens Motion',
      'SKU-2088,Stainless Ball Bearing 6204,Bearings,1200,pcs,6.75,250,Main Hub,SKF Group',
      'SKU-3015,Optical Photoelectric Sensor,Sensors,14,pcs,92.50,25,West Depot,Omron Automation',
    ].join('\n');

    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vantagestock-inventory-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clearStagedFile() {
    setFilename('');
    setCsvText('');
    setHeaders([]);
    setPreviewRows([]);
    setColumnMap({});
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleRunImport() {
    if (!csvText.trim()) return;
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      const res = await apiRequest<CsvImportResult>(
        `/api/tenants/${encodeURIComponent(companyId)}/inventory/import-csv`,
        {
          method: 'POST',
          body: JSON.stringify({
            filename,
            csvText,
            duplicateMode,
            columnMap,
          }),
        }
      );
      setResult(res);
      onImportSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Upload & Mapping Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Bulk CSV Inventory Feed
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Ingest structured CSV files directly into{' '}
              <span className="font-medium text-slate-800">{companyName}</span>&apos;s isolated database. Up to 10,000 rows per batch.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download Sample CSV
          </button>
        </div>

        {!canWrite ? (
          <div className="mt-5 p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
            Your role (<span className="font-medium">Viewer</span>) has read-only permissions. Contact your Company Admin or Master Admin to upload CSV feeds.
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {error && (
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {result && (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>CSV Batch Committed to Isolated Storage</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setResult(null)}
                    className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono tabular-nums">
                  <div>
                    <span className="text-emerald-700 block text-[11px] font-sans">Total Rows</span>
                    <span className="font-semibold text-emerald-950">{formatNumber(result.totalRows)}</span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block text-[11px] font-sans">Inserted</span>
                    <span className="font-semibold text-emerald-950">+{formatNumber(result.insertedCount)}</span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block text-[11px] font-sans">Updated</span>
                    <span className="font-semibold text-emerald-950">{formatNumber(result.updatedCount)}</span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block text-[11px] font-sans">Skipped</span>
                    <span className="font-semibold text-emerald-950">{formatNumber(result.skippedCount)}</span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block text-[11px] font-sans">Row Errors</span>
                    <span className={`font-semibold ${result.errorCount > 0 ? 'text-amber-700' : 'text-emerald-950'}`}>
                      {formatNumber(result.errorCount)}
                    </span>
                  </div>
                </div>
                {result.errors.length > 0 && (
                  <div className="pt-2 border-t border-emerald-200/80 text-xs text-amber-900 space-y-1">
                    <div className="font-medium">Skipped / Invalid Rows:</div>
                    {result.errors.slice(0, 5).map((err, idx) => (
                      <div key={idx} className="font-mono text-[11px]">
                        Row {err.row} ({err.sku}): {err.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!csvText ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0] ?? null;
                  handleFileSelected(file);
                }}
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                  dragOver
                    ? 'border-blue-600 bg-blue-50/60'
                    : 'border-slate-300 bg-slate-50/50 hover:border-slate-400'
                }`}
              >
                <Upload className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="mt-3 font-display text-sm font-semibold text-slate-900">
                  Drop a CSV file here or browse from disk
                </h3>
                <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                  Supports standard headers: <span className="font-mono">sku, name, category, quantity, unit, unit_price, reorder_level, warehouse, supplier</span>
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  Select CSV File
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileSpreadsheet className="w-5 h-5 text-blue-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-slate-900 truncate">
                        {filename}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {headers.length} columns detected · previewing first {previewRows.length} rows
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      aria-label="Duplicate SKU strategy"
                      value={duplicateMode}
                      onChange={(e) => setDuplicateMode(e.target.value as 'upsert' | 'skip')}
                      className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="upsert">Update existing SKUs on match</option>
                      <option value="skip">Skip existing SKUs</option>
                    </select>
                    <button
                      type="button"
                      onClick={clearStagedFile}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md bg-white cursor-pointer"
                    >
                      Change File
                    </button>
                  </div>
                </div>

                {/* Column Mapping Grid */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-800 mb-2.5">
                    Column Field Mapping
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {TARGET_FIELDS.map((field) => (
                      <div key={field.key} className="flex flex-col gap-1">
                        <label className="text-[11px] font-medium text-slate-600">
                          {field.label}
                        </label>
                        <select
                          value={columnMap[field.key] || ''}
                          onChange={(e) =>
                            setColumnMap((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="">-- Unmapped --</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Data Preview Table */}
                {previewRows.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-medium text-slate-600">
                      Parsed CSV Sample Preview
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-white text-[11px] text-slate-500">
                            {headers.map((h, i) => (
                              <th key={i} className="py-2 px-3 font-mono font-medium whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewRows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {headers.map((_, cIdx) => (
                                <td key={cIdx} className="py-2 px-3 text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                                  {row[cIdx] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={clearStagedFile}
                    className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => void handleRunImport()}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-medium rounded-lg cursor-pointer"
                  >
                    {importing ? 'Ingesting CSV Batch...' : 'Commit CSV to Inventory'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Historical CSV Batch Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            CSV Batch Ingestion History
          </h3>
        </div>
        {recentImports.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No CSV files have been imported into this tenant yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4">Filename</th>
                  <th className="py-2.5 px-4">Uploaded By</th>
                  <th className="py-2.5 px-4 text-right">Rows</th>
                  <th className="py-2.5 px-4 text-right">Inserted</th>
                  <th className="py-2.5 px-4 text-right">Updated</th>
                  <th className="py-2.5 px-4 text-right">Skipped</th>
                  <th className="py-2.5 px-4 text-right">Errors</th>
                  <th className="py-2.5 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                {recentImports.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-medium text-slate-900">{b.filename}</td>
                    <td className="py-2.5 px-4 font-sans text-slate-600">{b.actor_username}</td>
                    <td className="py-2.5 px-4 text-right text-slate-800">{b.total_rows}</td>
                    <td className="py-2.5 px-4 text-right text-emerald-700">+{b.inserted_count}</td>
                    <td className="py-2.5 px-4 text-right text-blue-700">{b.updated_count}</td>
                    <td className="py-2.5 px-4 text-right text-slate-500">{b.skipped_count}</td>
                    <td className="py-2.5 px-4 text-right">
                      <span className={b.error_count > 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}>
                        {b.error_count}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-500">
                      {formatDateTime(b.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
