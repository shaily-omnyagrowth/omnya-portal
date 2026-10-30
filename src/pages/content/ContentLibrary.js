import { useState } from "react";
import PostsGalleryView from "../../components/PostsGalleryView";
import VideoMetricsPanel from "../../components/VideoMetricsPanel";
import Dialog from "../../ui/Dialog";
import PageHeader from "../../ui/PageHeader";

const LIVE = new Set(["Approved", "Published/Tracked"]);

export default function ContentLibrary({ db }) {
  const [selected, setSelected] = useState(null);
  const delivered = db.submissions.filter(s => LIVE.has(s.status));
  const sub = selected && db.submissions.find(s => s.id === selected.id);

  return (
    <div className="content">
      <PageHeader title="Content library" description="Every approved video across campaigns. Open one to see its growth and engagement." />
      <PostsGalleryView submissions={delivered} analytics={db.analytics} creators={db.creators} campaigns={db.campaigns} onSelect={setSelected} />
      {sub && (
        <Dialog size="lg" title={selected.creatorName} description={selected.campaignName} onClose={() => setSelected(null)}>
          <VideoMetricsPanel sub={sub} analytics={selected.analytics} campaignName={selected.campaignName} />
        </Dialog>
      )}
    </div>
  );
}
