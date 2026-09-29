import { History, Lightbulb, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Store } from "@/hooks/use-store";
import type { MemberUser } from "@/lib/session";
import AccountsView from "@/components/views/Accounts";
import LogsView from "@/components/views/Logs";
import { FeedbackAdminView } from "@/components/views/Feedback";

export type AdminSection = "accounts" | "logs" | "feedback";

export default function AdminView({
  store,
  currentMember,
  section,
  onSection,
}: {
  store: Store;
  currentMember: MemberUser;
  section: AdminSection;
  onSection: (section: AdminSection) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
        <Button
          size="sm"
          variant={section === "accounts" ? "secondary" : "ghost"}
          className={
            "flex-1 justify-start " + (section === "accounts" ? "font-semibold text-primary" : "text-muted-foreground")
          }
          onClick={() => onSection("accounts")}
        >
          <ShieldCheck className="size-4" /> 账号管理
        </Button>
        <Button
          size="sm"
          variant={section === "feedback" ? "secondary" : "ghost"}
          className={
            "flex-1 justify-start " + (section === "feedback" ? "font-semibold text-primary" : "text-muted-foreground")
          }
          onClick={() => onSection("feedback")}
        >
          <Lightbulb className="size-4" /> 意见反馈
        </Button>
        <Button
          size="sm"
          variant={section === "logs" ? "secondary" : "ghost"}
          className={
            "flex-1 justify-start " + (section === "logs" ? "font-semibold text-primary" : "text-muted-foreground")
          }
          onClick={() => onSection("logs")}
        >
          <History className="size-4" /> 操作日志
        </Button>
      </div>
      {section === "accounts" ? (
        <AccountsView currentMember={currentMember} />
      ) : section === "feedback" ? (
        <FeedbackAdminView store={store} />
      ) : (
        <LogsView store={store} />
      )}
    </section>
  );
}
