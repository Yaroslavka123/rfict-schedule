import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DAY_ORDER, PAIRS } from '@/lib/constants'
import { categorizeRoom, findRoomLessons, getRooms } from '@/lib/schedule'
import type { ScheduleLesson } from '@/types/schedule'

interface RoomsViewProps {
  lessons: ScheduleLesson[]
}

export function RoomsView({ lessons }: RoomsViewProps) {
  const rooms = getRooms(lessons)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Занятость кабинетов</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Матрица по дням, парам и аудиториям</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">Лекционные</Badge>
          <Badge tone="blue">Компьютерные</Badge>
          <Badge tone="muted">Обычные</Badge>
          <Badge tone="purple">Несколько занятий</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rooms.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">Кабинеты не найдены.</div>
        ) : (
          <div className="overflow-auto">
            <table className="rooms-table">
              <thead>
                <tr>
                  <th className="sticky-col">День</th>
                  <th className="sticky-col second">Пара</th>
                  {rooms.map((room) => (
                    <th key={room}>{room}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAY_ORDER.flatMap((day) => PAIRS.map((pair) => (
                  <tr key={`${day}-${pair}`}>
                    <td className="sticky-col font-semibold">{day}</td>
                    <td className="sticky-col second font-semibold">{pair}</td>
                    {rooms.map((room) => {
                      const roomLessons = findRoomLessons(lessons, room, day, pair)
                      return <RoomCell key={room} room={room} lessons={roomLessons} />
                    })}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RoomCell({ room, lessons }: { room: string; lessons: ScheduleLesson[] }) {
  if (lessons.length === 0) return <td className="room-cell room-free">Свободно</td>
  const category = categorizeRoom(room)
  const title = lessons.map((lesson) => `${lesson.subject} · ${lesson.group} · ${lesson.teacher || 'без преподавателя'}`).join('\n')
  return (
    <td className={`room-cell room-busy room-${lessons.length > 1 ? 'multi' : category.tone}`} title={title}>
      <span>{lessons.length > 1 ? `${lessons.length} занятия` : lessons[0].subject}</span>
    </td>
  )
}
