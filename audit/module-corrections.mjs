import fs from 'node:fs';
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
edit('src/lib/api/vehicleHistory.js',s=>{const a=s.indexOf('/**\n * Corrective actions related');const b=s.indexOf('// Related records are');return s.slice(0,a)+s.slice(b)});
edit('src/test/qrBulkPageWiring.test.js',s=>s.replaceAll(`from('vehicle_fleet')`,`countryQuery('vehicle_fleet'`));
edit('src/pages/PmPrograms.jsx',s=>s.replace('    } catch (err) {\n      if (isMissingRelation(err))','    } catch (err) {\n      if (request !== loadId.current) return\n      if (isMissingRelation(err))').replace('setHistory([]); setCost({ tyre: 0, maintenance: 0, byMonth: [] })','setHistory([]); setCost(null)').replace('    } finally {\n      setRefreshing(false)','    } finally {\n      if (request === loadId.current) setRefreshing(false)'));
edit('src/pages/WorkshopLive.jsx',s=>s.replace('    mounted.current = true\n    load()', '    mounted.current = true\n    setRaw(null); setSiteFilter(\'All\')\n    load()'));
edit('src/lib/api/pmPrograms.js',s=>s.replace("await supabase\n        .from('vehicle_fleet').select('asset_no,current_km').in('asset_no', c)","await applyCountry(supabase\n        .from('vehicle_fleet').select('asset_no,current_km').in('asset_no', c), country)").replace("await supabase\n        .from('engine_hours_logs').select('asset_no,engine_hours,reading_date')\n        .in('asset_no', c).order('reading_date', { ascending: false })","await fetchAllPages((from, to) => applyCountry(supabase\n        .from('engine_hours_logs').select('asset_no,engine_hours,reading_date')\n        .in('asset_no', c), country).order('reading_date', { ascending: false }).order('id').range(from, to))").replaceAll('  } catch {\n    // Missing relation or read error: leave kmByAsset as collected (never throw).\n  }','  } catch (error) { throw error }').replaceAll('  } catch {\n    // Missing relation or read error: leave hoursByAsset as collected (never throw).\n  }','  } catch (error) { throw error }'));
edit('src/pages/TyreRecords.jsx',s=>s.replace('  const [records, setRecords]',"  const [exporting, setExporting] = useState(false)\n  const [exportError, setExportError] = useState('')\n  const [records, setRecords]").replace('    const { data } = await tyreRecordsApi.listAllRecords({','    const { data, error, truncated } = await tyreRecordsApi.listAllRecords({').replace('    return data ?? []','    if (error) throw error\n    if (truncated) throw new Error("Too many records to export completely. Narrow your filters.")\n    return data ?? []').replace('  // Shared column header style',`  async function downloadRecords(kind) {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
      const rows = await fetchAll()
      const exporter = await loadExportUtils()
      const name = 'TyrePulse_Records_' + new Date().toISOString().slice(0, 10)
      if (kind === 'excel') await exporter.exportToExcel(rows, EXPORT_COLS.map(c => c.key), EXPORT_COLS.map(c => c.header), name, 'Tyre Records')
      else await exporter.exportToPdf(rows, EXPORT_COLS, 'Tyre Records · ' + rows.length.toLocaleString() + ' records', name)
    } catch (err) { setExportError(toUserMessage(err, 'Could not download these records. Please retry.')) }
    finally { setExporting(false) }
  }

  // Shared column header style`).replace(/onClick=\{async \(\) => \(await loadExportUtils\(\)\)\.exportToExcel[^\n]+/,'disabled={exporting} onClick={() => downloadRecords(\'excel\')}').replace(/onClick=\{async \(\) => \(await loadExportUtils\(\)\)\.exportToPdf[^\n]+/,'disabled={exporting} onClick={() => downloadRecords(\'pdf\')}').replace('<div className="space-y-5">','<div className="space-y-5">\n      {exportError && <p role="alert" className="text-red-500">{exportError}</p>}'));
