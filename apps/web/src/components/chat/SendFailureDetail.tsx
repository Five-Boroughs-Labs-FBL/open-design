import { sanitizeSendFailureDetail } from '@open-design/contracts';
import styles from './SendFailureDetail.module.css';

export function SendFailureDetail({ detail }: { detail?: string }) {
  const text = sanitizeSendFailureDetail(detail);
  return text ? (
    <p className={styles.detail} role="alert" data-testid="user-send-failure-detail">{text}</p>
  ) : null;
}
