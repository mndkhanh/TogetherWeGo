import { currentLocale } from "@/i18n"

/**
 * Vietnamese for the messages the API and the shared zod schemas send in English (validation
 * errors, 4xx reasons). They're keyed by the English text, so the server and the shared schemas
 * stay one language and the web app translates what it shows. Anything missing falls back to
 * the English, which is always a complete sentence.
 */
const EXACT: Record<string, string> = {
  // ---------- Form fields (shared zod schemas) ----------
  "A percentage can’t be over 100%": "Phần trăm không được quá 100%",
  "Allow at least 1 use": "Cho phép ít nhất 1 lần dùng",
  "Choose 1, 7 or 30 days": "Chọn 1, 7 hoặc 30 ngày",
  "Choose English or Vietnamese": "Chọn tiếng Anh hoặc tiếng Việt",
  "Choose VND or USD": "Chọn VND hoặc USD",
  "Choose a date": "Chọn ngày",
  "Choose a password": "Đặt mật khẩu",
  "Choose a time zone": "Chọn múi giờ",
  "Choose going, maybe or can’t go": "Chọn sẽ đi, có thể hoặc không đi được",
  "Choose how to split it": "Chọn cách chia",
  "Choose owner, admin or member": "Chọn chủ nhóm, quản trị viên hoặc thành viên",
  "Choose someone else": "Chọn người khác",
  "Choose when it starts": "Chọn thời gian bắt đầu",
  "Choose when the link expires": "Chọn thời hạn của liên kết",
  "Choose who gets paid": "Chọn người được trả",
  "Choose who paid": "Chọn người đã trả",
  "Choose who sent it": "Chọn người đã gửi",
  "Choose who shared this expense": "Chọn những người cùng chia khoản chi này",
  "Choose your bank": "Chọn ngân hàng của bạn",
  "Each person can appear only once": "Mỗi người chỉ được xuất hiện một lần",
  "Email address is too long": "Địa chỉ email quá dài",
  "End after it starts": "Thời gian kết thúc phải sau khi bắt đầu",
  "Enter a group name": "Nhập tên nhóm",
  "Enter a valid amount": "Nhập số tiền hợp lệ",
  "Enter a valid email address, like name@example.com":
    "Nhập địa chỉ email hợp lệ, ví dụ name@example.com",
  "Enter a valid end time": "Nhập thời gian kết thúc hợp lệ",
  "Enter an amount": "Nhập số tiền",
  "Enter an amount greater than 0": "Nhập số tiền lớn hơn 0",
  "Enter the name on the account": "Nhập tên chủ tài khoản",
  "Enter your account number": "Nhập số tài khoản",
  "Enter your email address": "Nhập địa chỉ email",
  "Enter your name": "Nhập tên của bạn",
  "Enter your password": "Nhập mật khẩu",
  "Give at least one person a share": "Chia cho ít nhất một người",
  "Give the event a name": "Đặt tên cho sự kiện",
  "Nobody pays anything": "Không ai phải trả gì cả",
  "Say what it was for": "Ghi rõ khoản chi cho việc gì",
  "That amount is too large": "Số tiền quá lớn",
  "Use 128 characters or fewer": "Dùng tối đa 128 ký tự",
  "Use 500 characters or fewer": "Dùng tối đa 500 ký tự",
  "Use 60 characters or fewer": "Dùng tối đa 60 ký tự",
  "Use 80 characters or fewer": "Dùng tối đa 80 ký tự",
  "Use 1000 characters or fewer": "Dùng tối đa 1000 ký tự",
  "Use a JPEG, PNG or WebP photo": "Dùng ảnh JPEG, PNG hoặc WebP",
  "Use at least 10 characters": "Dùng ít nhất 10 ký tự",
  "Use numbers of 0 or more": "Dùng số từ 0 trở lên",
  "Use whole numbers": "Dùng số nguyên",
  "Use whole, non-negative numbers": "Dùng số nguyên không âm",
  "Write something first": "Hãy viết gì đó trước",

  // ---------- Expense history (server-written) ----------
  "Linked to an event": "Đã gắn với một sự kiện",
  "Unlinked from its event": "Đã bỏ gắn khỏi sự kiện",
  "Note edited": "Đã sửa ghi chú",
  "Note removed": "Đã xoá ghi chú",
  "Receipt removed": "Đã xoá hoá đơn",
  "Receipt replaced": "Đã thay hoá đơn",
  "Receipt added": "Đã thêm hoá đơn",

  // ---------- API ----------
  "Add your bank account before setting up SePay": "Thêm tài khoản ngân hàng trước khi cài SePay",
  "An account with this email already exists": "Email này đã có tài khoản",
  "Bank transfers can only settle groups that use VND":
    "Chuyển khoản ngân hàng chỉ dùng được cho nhóm tính bằng VND",
  "Both people must be members of the group": "Cả hai người phải là thành viên của nhóm",
  "Comment not found": "Không tìm thấy bình luận",
  "Event not found": "Không tìm thấy sự kiện",
  "Everyone on an expense must be a member of the group":
    "Mọi người trong khoản chi phải là thành viên của nhóm",
  "Expense not found": "Không tìm thấy khoản chi",
  "Google sign-in is not configured": "Chưa cài đặt đăng nhập bằng Google",
  "Group not found": "Không tìm thấy nhóm",
  "Invalid email or password": "Email hoặc mật khẩu không đúng",
  "Invite not found": "Không tìm thấy lời mời",
  "Make someone else the owner before you leave the group":
    "Hãy chuyển quyền chủ nhóm cho người khác trước khi rời nhóm",
  "No bank account added": "Chưa thêm tài khoản ngân hàng",
  "Nothing to update": "Không có gì để cập nhật",
  "Notification not found": "Không tìm thấy thông báo",
  "Only the person being paid can confirm a payment":
    "Chỉ người được trả tiền mới xác nhận được khoản thanh toán",
  "Only the person who added it, the person who paid, or a group admin can change this expense":
    "Chỉ người thêm, người đã trả hoặc quản trị viên nhóm mới sửa được khoản chi này",
  "Only the person who planned it or a group admin can change it":
    "Chỉ người lên lịch hoặc quản trị viên nhóm mới thay đổi được",
  "Only the person who wrote it or a group admin can delete it":
    "Chỉ người viết hoặc quản trị viên nhóm mới xoá được",
  "Only the two people in a payment can cancel it":
    "Chỉ hai người trong khoản thanh toán mới huỷ được",
  "Payment not found": "Không tìm thấy khoản thanh toán",
  "Receipt photos aren’t available right now": "Hiện chưa dùng được ảnh hoá đơn",
  "Someone else changed this event. Reload to see the latest version.":
    "Có người vừa thay đổi sự kiện này. Tải lại để xem bản mới nhất.",
  "Someone else changed this expense. Reload to see the latest version.":
    "Có người vừa thay đổi khoản chi này. Tải lại để xem bản mới nhất.",
  "That payment is already confirmed": "Khoản thanh toán này đã được xác nhận",
  "This payment is already confirmed": "Khoản thanh toán này đã được xác nhận",
  "That person is not a member of this group": "Người này không phải thành viên của nhóm",
  "That receipt upload is not valid. Upload the photo again.":
    "Ảnh hoá đơn tải lên không hợp lệ. Hãy tải lại ảnh.",
  "The group’s currency just changed. Reload and try again.":
    "Nhóm vừa đổi đơn vị tiền. Tải lại rồi thử lần nữa.",
  "The receipt photo didn’t finish uploading. Try again.":
    "Ảnh hoá đơn chưa tải lên xong. Thử lại nhé.",
  "This event is already cancelled": "Sự kiện này đã bị huỷ rồi",
  "This event was cancelled": "Sự kiện này đã bị huỷ",
  "This group is archived. Unarchive it to make changes.":
    "Nhóm này đã được lưu trữ. Bỏ lưu trữ để thay đổi.",
  "This invite link has expired or is no longer valid. Ask for a new one.":
    "Liên kết mời đã hết hạn hoặc không còn dùng được. Hãy xin liên kết mới.",
  "This transfer has already been sorted out": "Giao dịch này đã được xử lý",
  "This transfer is over the limit for one payment. Ignore it here and sort it out directly.":
    "Giao dịch này vượt hạn mức của một khoản thanh toán. Hãy bỏ qua ở đây và tự xử lý trực tiếp.",
  "Transfer not found": "Không tìm thấy giao dịch",
  "User not found": "Không tìm thấy người dùng",
  "You can only record payments you made or received":
    "Bạn chỉ ghi nhận được khoản bạn đã trả hoặc đã nhận",
  "You can only remove members with a lower role than yours":
    "Bạn chỉ xoá được thành viên có vai trò thấp hơn bạn",
  "You can’t change the currency after expenses or payments have been added":
    "Không thể đổi đơn vị tiền sau khi đã có khoản chi hoặc thanh toán",
  "You have a payment waiting to be confirmed or cancelled in this group. Sort it out before you leave.":
    "Bạn có khoản thanh toán đang chờ xác nhận hoặc huỷ trong nhóm này. Hãy xử lý trước khi rời nhóm.",
  "You have too many payments waiting. Cancel the ones you won’t make first.":
    "Bạn có quá nhiều khoản đang chờ. Hãy huỷ những khoản bạn sẽ không trả trước.",
  "You still owe or are owed money in this group. Settle up before you leave.":
    "Bạn vẫn còn nợ hoặc được nợ trong nhóm này. Hãy thanh toán xong trước khi rời nhóm.",
}

const ROLE: Record<string, string> = {
  owner: "chủ nhóm",
  admin: "quản trị viên",
  member: "thành viên",
}

/** Messages with a value inside. */
const PATTERNS: [RegExp, (...groups: string[]) => string][] = [
  [
    /^The amounts add up to (.+), not (.+)$/u,
    (sum, total) => `Tổng các phần là ${sum}, chưa bằng ${total}`,
  ],
  [
    /^The percentages add up to (.+)%, not 100%$/u,
    (sum) => `Tổng phần trăm là ${sum}%, chưa bằng 100%`,
  ],
  [
    /^Only a group (owner|admin|member) can do this$/u,
    (role) => `Chỉ ${ROLE[role] ?? role} của nhóm mới làm được việc này`,
  ],
  [/^Use (\d+) characters or fewer$/u, (n) => `Dùng tối đa ${n} ký tự`],
  [/^This group is full \((\d+) members\)$/u, (n) => `Nhóm đã đủ người (${n} thành viên)`],
  [
    /^(.+) has left the group, so this expense can’t be changed$/u,
    (name) => `${name} đã rời nhóm nên không thể sửa khoản chi này`,
  ],
  [/^Request failed \((\d+)\)$/u, (status) => `Yêu cầu thất bại (${status})`],
  // Expense history: "Label: before → after".
  [/^Title: (.*)$/su, (rest) => `Tiêu đề: ${rest}`],
  [/^Amount: (.*)$/su, (rest) => `Số tiền: ${rest}`],
  [/^Paid by: (.*)$/su, (rest) => `Người trả: ${rest}`],
  [/^Date: (.*)$/su, (rest) => `Ngày: ${rest}`],
  [/^Split: (.*)$/su, (rest) => `Cách chia: ${rest}`],
]

/** A message from the API or a schema, in the current language. */
export function translateMessage(message: string): string {
  if (currentLocale() !== "vi") return message
  const exact = EXACT[message]
  if (exact) return exact
  for (const [pattern, render] of PATTERNS) {
    const match = pattern.exec(message)
    if (match) return render(...match.slice(1))
  }
  return message
}
