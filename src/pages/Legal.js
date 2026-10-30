import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import Icon from "../ui/Icon";
import PageHeader from "../ui/PageHeader";

// The policy text lives only in the static public/*.html pages that TikTok and Meta reviewed; this links to them.
const DOCS = [
  { href: "/privacy", title: "Privacy policy", text: "What the portal collects, including data from connected TikTok, Instagram, Facebook and YouTube accounts, who can see it and how long we keep it." },
  { href: "/terms", title: "Terms of service", text: "The rules for using the portal: accounts, connected social accounts, content rights, payments and ending your account." },
  { href: "/data-deletion", title: "Data deletion", text: "How to disconnect a social account, revoke access from the platform, or ask us to delete your data." },
];

export default function Legal() {
  return (
    <div className="content" style={{ maxWidth: 880 }}>
      <PageHeader title="Legal center" description="Omnya Growth LLC policies. Each opens in a new tab." />
      <div className="card flush">
        {DOCS.map(d => (
          <a key={d.href} className="legal-row" href={d.href} target="_blank" rel="noopener noreferrer">
            <span className="min-w-0"><span className="fw-600 text-ink" style={{ display: "block" }}>{d.title}</span><span className="fs-13 text-muted">{d.text}</span></span>
            <Icon icon={ArrowUpRight01Icon} size={16} />
          </a>
        ))}
      </div>
      <p className="fs-13 text-muted mt-16">Questions or data requests? Email <a className="link" href="mailto:hello@omnyagrowth.com">hello@omnyagrowth.com</a>.</p>
    </div>
  );
}
