import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { listenTables } from '../../services/tableService';
import { getRestaurant } from '../../services/restaurantService';
import { Loading, EmptyState } from '../../components/Common';

export default function QRCodesPage() {
  const { restaurantId } = useAuth();
  const toast = useToast();
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurantName, setRestaurantName] = useState('');
  const canvasRefs = useRef({});

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = listenTables(
      restaurantId,
      (data) => {
        setTables(data);
        setLoading(false);
      },
      () => setLoading(false)
    );
    getRestaurant(restaurantId)
      .then((r) => setRestaurantName(r?.name || ''))
      .catch(() => setRestaurantName(''));
    return () => unsub();
  }, [restaurantId]);

  const downloadOne = (table) => {
    const canvas = canvasRefs.current[table.id];
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `table-${table.tableNumber}-qr.png`;
    link.click();
  };

  const downloadAll = async () => {
    try {
      const jsPDFModule = await import('jspdf');
      const { jsPDF } = jsPDFModule;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const cardWidth = 90;
      const cardHeight = 110;
      const margin = 10;
      let x = margin;
      let y = margin;

      tables.forEach((table, idx) => {
        const canvas = canvasRefs.current[table.id];
        if (!canvas) return;
        const imgData = canvas.toDataURL('image/png');

        pdf.setFontSize(14);
        pdf.text(restaurantName || 'Scan to Order', x + cardWidth / 2, y + 8, { align: 'center' });
        pdf.addImage(imgData, 'PNG', x + (cardWidth - 60) / 2, y + 12, 60, 60);
        pdf.setFontSize(16);
        pdf.text(`Table ${table.tableNumber}`, x + cardWidth / 2, y + 82, { align: 'center' });
        pdf.setFontSize(10);
        pdf.text('Scan to Order', x + cardWidth / 2, y + 90, { align: 'center' });

        x += cardWidth + margin;
        if (x + cardWidth > 210 - margin) {
          x = margin;
          y += cardHeight + margin;
        }
        if (y + cardHeight > 297 - margin && idx < tables.length - 1) {
          pdf.addPage();
          x = margin;
          y = margin;
        }
      });

      pdf.save('all-table-qr-codes.pdf');
    } catch (err) {
      toast.error('Could not generate the QR PDF.');
    }
  };

  const printOne = (table) => {
    const canvas = canvasRefs.current[table.id];
    if (!canvas) return;
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Table ${table.tableNumber} QR</title></head>
      <body style="text-align:center;font-family:sans-serif;padding:40px;">
        <h2>Table ${table.tableNumber}</h2>
        <img src="${canvas.toDataURL('image/png')}" style="width:280px;height:280px;" />
        <p>Scan to Order</p>
        <script>window.onload = () => window.print();</script>
      </body></html>
    `);
    win.document.close();
  };

  if (loading) return <Loading fullPage label="Loading QR codes…" />;

  if (tables.length === 0) {
    return (
      <div className="page">
        <h1>QR Codes</h1>
        <EmptyState icon="🔲" title="No tables yet" description="Add tables first to generate their QR codes." />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>QR Codes</h1>
        <button className="btn btn-primary" onClick={downloadAll}>
          Download all (PDF)
        </button>
      </div>

      <div className="qr-grid">
        {tables.map((table) => (
          <div key={table.id} className="qr-card">
            <h3>Table {table.tableNumber}</h3>
            <QRCodeCanvas
              value={table.qrUrl}
              size={200}
              ref={(el) => {
                if (el) canvasRefs.current[table.id] = el;
              }}
            />
            <p className="qr-instruction">Scan to Order</p>
            <div className="qr-card-actions">
              <button className="btn btn-small btn-ghost" onClick={() => downloadOne(table)}>
                Download PNG
              </button>
              <button className="btn btn-small btn-ghost" onClick={() => printOne(table)}>
                Print
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
