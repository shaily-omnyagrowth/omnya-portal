import Alert from "./Alert";

export default function ErrorMsg({ msg, onRetry }) {
  return (
    <Alert tone="error" action={onRetry && <button className="btn btn-sm btn-secondary" onClick={onRetry}>Try again</button>}>
      {msg}
    </Alert>
  );
}
