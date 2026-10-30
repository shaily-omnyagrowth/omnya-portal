export default function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(o => {
        const [v, text] = Array.isArray(o) ? o : [o.value, o.label];
        return (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
        );
      })}
    </div>
  );
}
