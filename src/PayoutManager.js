import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://aglikzyarmqbdmjvkvyj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGlrenlhcm1xYmRtanZrdnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MjMwNDcsImV4cCI6MjA4NzI5OTA0N30.vYAk33Z_x5lWkKc6zUhTxhHiWo2cZgk3dYmO7c0I6GM";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function PayoutManager() {
  const [batches, setBatches] = [useState(null), useState([])][1]; // dummy hook override to fix linter locally
  const [batchList, setBatchList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    loadBatches();
  }, []);

  async function loadBatches() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('payout_batches')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setBatchList(data || []);
    } catch (err) {
      console.error('Failed to load batches:', err);
    } finally {
      setLoading(false);
    }
  }

  // Generate Weekly/Monthly Batch
  const handleGenerateBatch = async () => {
    if (!window.confirm("Compile all unpaid Approved Submissions into a new Draft Ledger?")) return;
    
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      // Hits the server-side API to enforce idempotency and secure ledger writes
      // /api/payouts/generate doesn't exist natively on client, it hits Vercel Proxy
      const res = await fetch('/api/payouts/generate', { method: 'POST' });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to generate batch');
      
      setMessage({ text: data.message || 'Batch generated successfully', type: 'success' });
      loadBatches();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  // Export CSV Action
  const handleExportCSV = async (batchId) => {
    try {
      const res = await fetch(`/api/payouts/export?batch_id=${batchId}`);
      if (!res.ok) throw new Error('Export failed');
      
      // Prompt standard file download trigger
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payout_batch_${batchId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    }
  };

  // Mark as Paid Action
  const handleMarkPaid = async (batchId) => {
    if (!window.confirm("WARNING: This will mark all ledgers inside this batch as PAID and dispatch email confirmations to Creators. Proceed?")) return;
    
    setWorking(true);
    try {
      const res = await fetch(`/api/payouts/mark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId })
      });
      if (!res.ok) throw new Error('Failed to update status');
      
      setMessage({ text: 'Batch permanently marked as PAID. Emails dispatched.', type: 'success' });
      loadBatches();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <div style={{ padding: 20 }}>Loading Payout History...</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Payout Operations</h2>
        <button 
          onClick={handleGenerateBatch}
          disabled={working}
          style={{ padding: '10px 20px', borderRadius: '6px', background: '#2563eb', color: '#fff', border: 'none', cursor: working ? 'wait' : 'pointer', fontWeight: 600 }}>
          {working ? 'Processing Ledger...' : '+ Generate New Batch'}
        </button>
      </div>

      {message.text && (
        <div style={{ 
          padding: '12px', 
          marginBottom: '24px', 
          borderRadius: '6px',
          background: message.type === 'success' ? '#dcfce7' : '#fee2e2',
          color: message.type === 'success' ? '#166534' : '#991b1b'
        }}>
          {message.text}
        </div>
      )}

      {/* Batches Table */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
        {batchList.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>No payout batches generated yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb', color: '#6b7280', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Batch ID</th>
                <th style={{ padding: '16px' }}>Gen Date</th>
                <th style={{ padding: '16px' }}>Total Amount</th>
                <th style={{ padding: '16px' }}>Volume</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {batchList.map(batch => (
                <tr key={batch.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '16px', fontFamily: 'monospace' }}>#{batch.id.substring(0,8)}</td>
                  <td style={{ padding: '16px' }}>{new Date(batch.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '16px', fontWeight: 'bold' }}>${(batch.total_amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                  <td style={{ padding: '16px' }}>{batch.total_creators || 0} Creators</td>
                  <td style={{ padding: '16px' }}>
                    <span style={{ 
                        padding: '4px 8px', borderRadius: '99px', fontSize: '12px', fontWeight: 500,
                        background: batch.status === 'paid' ? '#dcfce7' : '#fef3c7',
                        color: batch.status === 'paid' ? '#166534' : '#d97706'
                    }}>
                      {batch.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '16px', textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button onClick={() => handleExportCSV(batch.id)} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}>
                      Export CSV
                    </button>
                    
                    {batch.status !== 'paid' && (
                      <button 
                        onClick={() => handleMarkPaid(batch.id)} 
                        disabled={working}
                        style={{ padding: '6px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: working ? 'wait' : 'pointer' }}>
                        Mark as Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
