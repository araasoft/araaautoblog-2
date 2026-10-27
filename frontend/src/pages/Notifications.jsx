import { useState } from "react";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Empty from "../components/Empty";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { NOTE_ICON } from "../utils/constants";
import { fmt, safeUrl } from "../utils/format";

export default function Notifications() {
  const { data, loading, error, reload } = useAsync(() => api("GET", "/api/notifications"), []);
  const [perm, setPerm] = useState("Notification" in window ? Notification.permission : "denied");

  const readAll = async () => {
    await api("POST", "/api/notifications/read");
    window.dispatchEvent(new Event("araa:bell"));
    await reload(true);
  };
  const ask = async () => setPerm(await Notification.requestPermission());

  return (
    <QueryState loading={loading} error={error} data={data}>
      {data && (
        <>
          <div className="row sp" style={{ marginBottom: 12 }}>
            <b>{data.unread} unread</b>
            <div className="row">
              {perm === "default" && (
                <button type="button" className="sm" onClick={ask}>
                  <Icon name="bell" /> Phone alerts
                </button>
              )}
              <AsyncButton className="sm pri" onClick={readAll}>
                <Icon name="ok" /> Mark all read
              </AsyncButton>
            </div>
          </div>
          {data.items.length ? (
            data.items.map((n, i) => (
              <Card key={n.id || i} style={{ padding: 12, ...(n.unread ? { borderColor: "var(--pri2)" } : {}) }}>
                <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <span className="pl" style={{ background: n.level === "warning" ? "var(--warn)" : "var(--pri)", flex: "none" }}>
                    <Icon name={NOTE_ICON[n.type] || "bell"} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b>{n.title}</b>
                    <div style={{ wordWrap: "break-word" }}>{n.detail}</div>
                    <small className="hint">
                      {fmt(n.at)}
                      {n.by && n.by !== "System" ? " · " + n.by : ""}
                      {n.url && (
                        <>
                          {" · "}
                          <a href={safeUrl(n.url)} target="_blank" rel="noopener noreferrer">open</a>
                        </>
                      )}
                    </small>
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <Empty icon="bell" text="No notifications yet" />
          )}
        </>
      )}
    </QueryState>
  );
}
