import PostsGalleryView from "../../components/PostsGalleryView";
import PageHeader from "../../ui/PageHeader";
import ClientGate from "./ClientGate";
import useClient from "./useClient";

export default function ClientContent({ user, db }) {
  const state = useClient(user, db);
  return (
    <ClientGate state={state} variant="cards" onRetry={state.reload}>
      <div className="content">
        <PageHeader title="Delivered content" description="Every video delivered for your campaigns, with its live performance." />
        <PostsGalleryView submissions={state.submissions} analytics={db.analytics || []} creators={db.creators || []} campaigns={state.campaigns} initialView="gallery"
          emptyText="Approved videos show up here as soon as they're posted." />
      </div>
    </ClientGate>
  );
}
