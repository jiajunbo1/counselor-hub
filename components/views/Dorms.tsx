import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { EmptyHint, FormField, Select } from "@/components/form";
import type { Store } from "@/hooks/use-store";
import type { Room } from "@/lib/types";

const ALL = "__all";

interface RoomDraft {
  building: string;
  room_no: string;
  capacity: string;
  room_gender: string;
  note: string;
}

function roomDraft(room: Room | null): RoomDraft {
  return room
    ? { building: room.building, room_no: room.room_no, capacity: String(room.capacity), room_gender: room.room_gender, note: room.note }
    : { building: "", room_no: "", capacity: "4", room_gender: "不限", note: "" };
}

function RoomFormDialog({ room, onClose, store }: { room: Room | null; onClose: () => void; store: Store }) {
  const isEdit = room !== null;
  const [draft, setDraft] = useState<RoomDraft>(roomDraft(room));
  const [busy, setBusy] = useState(false);
  const set = (key: keyof RoomDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!draft.building.trim() || !draft.room_no.trim()) {
      toast.error("楼栋与房间号为必填项。");
      return;
    }
    setBusy(true);
    const payload = { ...draft, capacity: Number(draft.capacity) };
    const ok = isEdit
      ? await store.write("room.update", { id: room.id, ...payload })
      : await store.write("room.create", payload);
    setBusy(false);
    if (ok) {
      toast.success(isEdit ? "房间信息已更新" : "房间已添加");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑房间：${room.building} ${room.room_no}` : "添加房间"}</DialogTitle>
          <DialogDescription>床位数（1-12）。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="楼栋" required>
            <Input value={draft.building} onChange={(e) => set("building")(e.target.value)} placeholder="如：梅园1栋" maxLength={60} />
          </FormField>
          <FormField label="房间号" required>
            <Input value={draft.room_no} onChange={(e) => set("room_no")(e.target.value)} placeholder="如：101" maxLength={16} />
          </FormField>
          <FormField label="床位数">
            <Input value={draft.capacity} onChange={(e) => set("capacity")(e.target.value)} inputMode="numeric" />
          </FormField>
          <FormField label="入住性别">
            <Select
              value={draft.room_gender}
              onValueChange={set("room_gender")}
              options={[{ value: "男", label: "男生宿舍" }, { value: "女", label: "女生宿舍" }, { value: "不限", label: "不限" }]}
            />
          </FormField>
          <FormField label="备注" className="col-span-2">
            <Input value={draft.note} onChange={(e) => set("note")(e.target.value)} maxLength={200} />
          </FormField>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
            <Button onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  room,
  bedNo,
  occupantId,
  onClose,
  store,
}: {
  room: Room;
  bedNo: number;
  occupantId: string | null;
  onClose: () => void;
  store: Store;
}) {
  const candidates = useMemo(() => {
    const list = store.students.filter((s) => s.id !== occupantId);
    const filtered = room.room_gender === "不限" ? list : list.filter((s) => s.gender === room.room_gender);
    return [...filtered].sort((a, b) =>
      (a.dorm_room_id ? "1" : "0").localeCompare(b.dorm_room_id ? "1" : "0") || a.name.localeCompare(b.name, "zh-CN")
    );
  }, [store.students, room, occupantId]);
  const [studentId, setStudentId] = useState(candidates[0]?.id ?? ALL);
  const [bed, setBed] = useState(String(bedNo));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (studentId === ALL) {
      toast.error("暂无可选学生（所有学生已在此房间）。");
      return;
    }
    setBusy(true);
    const ok = await store.write("student.assign", { student_id: studentId, room_id: room.id, bed_no: Number(bed) });
    setBusy(false);
    if (ok) {
      toast.success("住宿安排已更新");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{occupantId ? "调整住宿" : "安排入住"}</DialogTitle>
          <DialogDescription>
            {room.building} {room.room_no}（{room.room_gender === "不限" ? "不限性别" : `${room.room_gender}生宿舍`}）
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField label="学生">
            <Select
              value={studentId}
              onValueChange={setStudentId}
              options={[
                { value: ALL, label: candidates.length === 0 ? "暂无可选学生" : "请选择学生" },
                ...candidates.map((s) => ({
                  value: s.id,
                  label: `${s.name}（${s.student_no}）${s.dorm_room_id ? " · 现住其他房间" : " · 未住宿"}`,
                })),
              ]}
            />
          </FormField>
          <FormField label="床位号">
            <Select
              value={bed}
              onValueChange={setBed}
              options={Array.from({ length: room.capacity }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 号床` }))}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "提交中…" : "确认"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DormsView({ store }: { store: Store }) {
  const { rooms, students } = store;
  const [building, setBuilding] = useState(ALL);
  const [roomForm, setRoomForm] = useState<Room | null | "new" | null>(null);
  const [assign, setAssign] = useState<{ room: Room; bedNo: number; occupantId: string | null } | null>(null);
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null);
  const [unassigning, setUnassigning] = useState<{ studentId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const buildings = useMemo(
    () => [{ value: ALL, label: "全部楼栋" }, ...[...new Set(rooms.map((r) => r.building))].sort().map((b) => ({ value: b, label: b }))],
    [rooms]
  );
  const filteredRooms = building === ALL ? rooms : rooms.filter((r) => r.building === building);
  const grouped = useMemo(() => {
    const map = new Map<string, Room[]>();
    for (const r of filteredRooms) {
      if (!map.has(r.building)) map.set(r.building, []);
      map.get(r.building)!.push(r);
    }
    return [...map.entries()];
  }, [filteredRooms]);

  const totalBeds = rooms.reduce((s, r) => s + r.capacity, 0);
  const usedBeds = students.filter((s) => s.dorm_room_id).length;

  const doUnassign = async () => {
    if (!unassigning) return;
    setBusy(true);
    const ok = await store.write("student.unassign", { student_id: unassigning.studentId });
    setBusy(false);
    if (ok) toast.success(`已为 ${unassigning.name} 办理退宿`);
    setUnassigning(null);
  };

  const doDeleteRoom = async () => {
    if (!deletingRoom) return;
    setBusy(true);
    const ok = await store.write("room.delete", { id: deletingRoom.id });
    setBusy(false);
    if (ok) toast.success("房间已删除");
    setDeletingRoom(null);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">宿舍管理</h1>
          <p className="text-sm text-muted-foreground">
            {rooms.length} 间房 · 入住 {usedBeds}/{totalBeds} 床位
          </p>
        </div>
        <Button onClick={() => setRoomForm("new")}>
          <Plus className="size-4" /> <span className="hidden sm:inline">添加房间</span><span className="sm:hidden">添加</span>
        </Button>
      </div>

      <div className="sm:w-56">
        <Select value={building} onValueChange={setBuilding} options={buildings} />
      </div>

      {filteredRooms.length === 0 ? (
        <EmptyHint text={rooms.length === 0 ? "还没有宿舍房间。" : "该楼栋下暂无房间。"} />
      ) : (
        grouped.map(([name, list]) => (
          <div key={name}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{name}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((room) => {
                const occupantByBed = new Map(room.students.map((s) => [s.bed_no, s]));
                return (
                  <div key={room.id} className="rounded-xl border bg-card p-4 shadow-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{room.room_no}</span>
                        <Badge variant="secondary" className="font-normal">{room.room_gender === "不限" ? "不限" : `${room.room_gender}宿舍`}</Badge>
                        <span className="text-xs tabular-nums text-muted-foreground">{room.students.length}/{room.capacity}</span>
                      </div>
                      <div className="flex">
                        <Button variant="ghost" size="icon" aria-label="编辑房间" onClick={() => setRoomForm(room)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="删除房间" onClick={() => setDeletingRoom(room)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    {room.note ? <p className="mt-1 text-xs text-muted-foreground">{room.note}</p> : null}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {Array.from({ length: room.capacity }, (_, i) => i + 1).map((bed) => {
                        const occupant = occupantByBed.get(bed);
                        return occupant ? (
                          <div key={bed} className="rounded-lg bg-secondary px-2.5 py-2">
                            <p className="truncate text-sm">{bed}号床 · {occupant.name}</p>
                            <div className="mt-1 flex items-center justify-between gap-1">
                              <span className="truncate text-[11px] text-muted-foreground">{occupant.class_name}</span>
                              <span className="flex shrink-0">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-[11px]"
                                  onClick={() => setAssign({ room, bedNo: bed, occupantId: occupant.id })}
                                >
                                  调宿
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-[11px] text-destructive"
                                  onClick={() => setUnassigning({ studentId: occupant.id, name: occupant.name })}
                                >
                                  退宿
                                </Button>
                              </span>
                            </div>
                          </div>
                        ) : (
                          <button
                            key={bed}
                            type="button"
                            className="rounded-lg border border-dashed px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                            onClick={() => setAssign({ room, bedNo: bed, occupantId: null })}
                          >
                            {bed}号床 · 空床位
                            <span className="block text-[11px]">点击安排入住</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {roomForm !== null ? (
        <RoomFormDialog
          key={roomForm === "new" ? "new" : roomForm.id}
          room={roomForm === "new" ? null : roomForm}
          onClose={() => setRoomForm(null)}
          store={store}
        />
      ) : null}

      {assign ? (
        <AssignDialog
          key={`${assign.room.id}-${assign.bedNo}-${assign.occupantId ?? "new"}`}
          room={assign.room}
          bedNo={assign.bedNo}
          occupantId={assign.occupantId}
          onClose={() => setAssign(null)}
          store={store}
        />
      ) : null}

      <AlertDialog open={unassigning !== null} onOpenChange={(open) => !open && setUnassigning(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>为 {unassigning?.name} 办理退宿？</AlertDialogTitle>
            <AlertDialogDescription>将清空该学生的房间与床位信息，学生档案保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void doUnassign()}>确认退宿</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deletingRoom !== null} onOpenChange={(open) => !open && setDeletingRoom(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除房间「{deletingRoom?.building} {deletingRoom?.room_no}」？</AlertDialogTitle>
            <AlertDialogDescription>仅当房间无学生入住时可以删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void doDeleteRoom()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
