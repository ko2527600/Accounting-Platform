export function exportToCsv(filename: string, rows: any[]) {
  if (!rows || !rows.length) return;

  const separator = ',';
  const keys = Object.keys(rows[0]);
  
  const csvContent = [
    // Header row
    keys.join(separator),
    // Data rows
    ...rows.map(row => {
      return keys.map(k => {
        let cell = row[k] === null || row[k] === undefined ? '' : row[k];
        // Convert to string and handle escaping quotes and commas
        cell = String(cell).replace(/"/g, '""');
        if (cell.search(/("|,|\n)/g) >= 0) {
          cell = `"${cell}"`;
        }
        return cell;
      }).join(separator);
    })
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
