import React, { useState } from 'react';
import auth from '../lib/auth';
import { API_BASE } from '../lib/likes';

type Props = {
  countryId: string | number;
  pattern: string;
};

export function ReportButton({ countryId, pattern }: Props) {
  const token = auth.getToken();
  const [showModal, setShowModal] = useState(false);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleReport = async () => {
    if (!token) {
      alert('Нужно авторизоваться');
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
          country_id: String(countryId),
          pattern,
          comment: comment || null
        })
      });

      if (res.ok) {
        alert('Спасибо! Репорт отправлен');
        setShowModal(false);
        setComment('');
      } else {
        const error = await res.json();
        alert(error.error || 'Ошибка отправки');
      }
    } catch (error) {
      console.error('Failed to submit report:', error);
      alert('Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        style={{
          padding: '6px 12px',
          backgroundColor: '#fbbf24',
          color: '#333',
          border: 'none',
          borderRadius: '3px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '500'
        }}
      >
        Report
      </button>

      {showModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={() => !submitting && setShowModal(false)}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '20px',
              borderRadius: '8px',
              minWidth: '300px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, marginBottom: '15px' }}>
              Репортить паттерн "{pattern}"?
            </h3>
            <textarea
              placeholder="Комментарий (опционально)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={{
                width: '100%',
                height: '100px',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontFamily: 'inherit',
                marginBottom: '15px',
                boxSizing: 'border-box',
                resize: 'none'
              }}
            />
            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-end'
              }}
            >
              <button
                onClick={() => !submitting && setShowModal(false)}
                disabled={submitting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#e5e7eb',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.6 : 1
                }}
              >
                Отмена
              </button>
              <button
                onClick={handleReport}
                disabled={submitting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.6 : 1
                }}
              >
                {submitting ? 'Отправка...' : 'Отправить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
