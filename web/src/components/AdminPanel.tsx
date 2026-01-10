import React, { useState, useEffect } from 'react';
import auth from '../lib/auth';
import { API_BASE } from '../lib/likes';
import { MapView } from './MapView';

export function AdminPanel() {
  const token = auth.getToken();
  const userId = auth.getCurrentUser();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [selfReportCountry, setSelfReportCountry] = useState('');
  const [selfReportPattern, setSelfReportPattern] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchReports();
  }, [token]);

  const fetchReports = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/admin/reports`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setReports(data);
      }
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerdictAccept = async (id, countryId, pattern) => {
    try {
      const res = await fetch(`${API_BASE}/admin/verdict?id=${id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ decision: 'accept' })
      });

      if (res.ok) {
        setReports(reports.filter(r => r.id !== id));
        alert('Паттерн скрыт');
      }
    } catch (error) {
      console.error('Failed to submit verdict:', error);
    }
  };

  const handleVerdictReject = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/admin/verdict?id=${id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ decision: 'reject' })
      });

      if (res.ok) {
        setReports(reports.filter(r => r.id !== id));
      }
    } catch (error) {
      console.error('Failed to submit verdict:', error);
    }
  };

  const handleSelfReport = async () => {
    if (!selfReportCountry || !selfReportPattern) {
      alert('Заполни оба поля');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/patterns/report`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          country_id: selfReportCountry,
          pattern: selfReportPattern,
          reason: 'admin'
        })
      });

      if (res.ok) {
        alert('Репорт добавлен');
        setSelfReportCountry('');
        setSelfReportPattern('');
        await fetchReports();
      } else {
        const error = await res.json();
        alert(error.error || 'Ошибка');
      }
    } catch (error) {
      console.error('Failed to submit report:', error);
      alert('Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div>Загрузка...</div>;
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Admin Panel - Pattern Reports</h1>

      <div style={{
        marginBottom: '30px',
        padding: '15px',
        border: '1px solid #ccc',
        borderRadius: '5px',
        backgroundColor: '#f9f9f9'
      }}>
        <h3>Добавить свой репорт</h3>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="text"
            placeholder="Country ID (e.g., 12)"
            value={selfReportCountry}
            onChange={(e) => setSelfReportCountry(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '10px',
              boxSizing: 'border-box'
            }}
          />
          <input
            type="text"
            placeholder="Pattern (e.g., -ium)"
            value={selfReportPattern}
            onChange={(e) => setSelfReportPattern(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '10px',
              boxSizing: 'border-box'
            }}
          />
        </div>
        <button
          onClick={handleSelfReport}
          disabled={submitting}
          style={{
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: submitting ? 'not-allowed' : 'pointer'
          }}
        >
          {submitting ? 'Отправка...' : 'Добавить репорт'}
        </button>
      </div>

      <h2>Pending Reports ({reports.length})</h2>

      <div style={{ display: 'grid', gap: '15px' }}>
        {reports.map(report => (
          <div
            key={report.id}
            style={{
              padding: '15px',
              border: '1px solid #ddd',
              borderRadius: '5px',
              backgroundColor: '#fff'
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '10px'
            }}>
              <div style={{ fontSize: '14px', color: '#666' }}>
                <strong>{report.pattern}</strong> in {report.country_id}
              </div>
              <div style={{ fontSize: '12px', color: '#999' }}>
                {new Date(report.created_at).toLocaleDateString()}
              </div>
            </div>

            {report.comment && (
              <div style={{
                marginBottom: '10px',
                padding: '10px',
                backgroundColor: '#f5f5f5',
                borderRadius: '3px',
                fontSize: '14px'
              }}>
                {report.comment}
              </div>
            )}

            <div style={{
              marginBottom: '10px',
              minHeight: '200px',
              backgroundColor: '#f0f0f0',
              borderRadius: '3px',
              overflow: 'hidden'
            }}>
              {expandedId === report.id ? (
                <div>
                  <MapView
                    countryId={parseInt(report.country_id)}
                    pattern={report.pattern}
                  />
                  <button
                    onClick={() => setExpandedId(null)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      backgroundColor: '#666',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Свернуть
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setExpandedId(report.id)}
                  style={{
                    width: '100%',
                    height: '100%',
                    padding: '20px',
                    backgroundColor: '#f0f0f0',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Нажми чтобы увидеть карту
                </button>
              )}
            </div>

            <div style={{
              display: 'flex',
              gap: '10px'
            }}>
              <button
                onClick={() => handleVerdictAccept(report.id, report.country_id, report.pattern)}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Accept
              </button>
              <button
                onClick={() => handleVerdictReject(report.id)}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Reject
              </button>
            </div>
          </div>
        ))}

        {reports.length === 0 && (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#999'
          }}>
            Нет непроверенных репортов
          </div>
        )}
      </div>
    </div>
  );
}
