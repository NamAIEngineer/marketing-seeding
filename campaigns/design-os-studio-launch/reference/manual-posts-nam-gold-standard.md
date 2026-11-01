# GOLD STANDARD — bài Nam đăng tay (Claude chép lại 05:58 2/11). Content + video phải chuẩn như này.

## A. Bài group gốc — HIỆU QUẢ NHẤT (73 like, 33 comment, 64 share)
Group: Cùng học Figma UI/UX & Product design (facebook.com/groups/figmavn), 23/10 11:42, link https://www.facebook.com/share/v/1EHvRWMnuv/
Video đính kèm: chính video mẫu release-recap (reference/release-recap-reference.mp4): mở bằng "design:os studio" trong khung selection xanh, rồi từng cảnh nhãn cam nhỏ (vd "0.5 Components") + headline 1 từ to ("Slots.") + UI thật bị crop/zoom.
---
Có bác nào đang nghịch **AI + UI/UX / Design System** thì có một project khá đáng để test:
**DESIGN Studio vừa lên v0.6.0 — AI Design.**
Điểm mình thấy hay là project này không đi theo kiểu "thêm một ô chat AI vào design tool", mà cho agent thực sự nhìn, hiểu và chỉnh document.
Bản mới có khá nhiều thứ liên quan trực tiếp tới agent workflow:
• Claude Code / Codex / Gemini / Grok / Antigravity chạy thành từng session trong Studio
• Có thể @mention layer, component, variable, style cho agent
• Agent sửa canvas xong có thể review → Keep hoặc Revert cả turn
• Mỗi turn có receipt: chạy bao lâu, gọi bao nhiêu tool, sửa bao nhiêu layer
• Agent có cursor riêng trên canvas
• MCP có screenshot, metadata, design context và search Design System
• Batch edit tối đa 200 operations trong một transaction
• Có dry-run + idempotency để tránh chạy lại rồi sửa trùng
• Lint trực tiếp kết quả AI tạo ra: overflow, overlap, contrast, hard-coded value, detached instance...
• Import web capture thành editable Auto Layout frames
• Dev Mode giờ có thêm HTML codegen
Nôm na là direction đang chuyển từ:
**"AI generate UI"**
sang:
**"AI làm việc trực tiếp trong một design environment có state, rules, undo/review và verification."**
Project này hiện được làm theo hướng nghiên cứu/học hỏi, dùng free và tác giả cũng nói chưa có kế hoạch thu phí.
Source: https://github.com/jangtrinh/design-os-studio
v0.6.0: https://github.com/jangtrinh/design-os-studio/releases/tag/v0.6.0
Ai đang làm Design System / Design Engineering test thử rồi cho xin feedback. Mình khá tò mò xem agent sửa trực tiếp production design thì mọi người quan tâm nhất **accuracy, controllability hay speed**?
#DesignOS #AIDesign #AIAgents #DesignEngineering #DesignSystems #Figma #MCP #Rust #BuildInPublic

## B. Bài follow-up cùng group (27 like, 4 comment, 18 share) — 27/10 11:51, https://www.facebook.com/share/v/1cmwxUwzEe/ — SHARE LẠI bài A
---
Mấy hôm trước mình có share DESIGN:OS Studio trong group rồi, nên lần này không giới thiệu lại dài nữa 😄
Update nhỏ: project hiện đang tham gia Unikorn Launchpad – Tools for Builders.
Mấy tuần vừa rồi Studio cũng tiếp tục đi sâu hơn vào workflow Figma / Design System / AI agent: .fig interoperability, components/variables, Dev Mode, agent edit có review Keep/Revert, transaction/undo và lint lại output sau khi AI sửa canvas.
Nếu anh em trước đó đã nghía project và thấy hướng này đáng thử thì có thể vào xem bản listing hiện tại và vote giúp:
https://unikorn.vn/c/tools-for-builders/e/designos-studio
Repo: https://github.com/jangtrinh/design-os-studio
Mình vẫn muốn xin feedback thật từ anh em Figma hơn là chỉ vote: nếu DESIGN:OS muốn chen vào workflow hiện tại của team, thứ nào phải làm thật tốt trước — .fig fidelity, components/variables, collaboration hay AI editing?
#Figma #DesignSystems #DesignEngineering #AIDesign #DesignOS

## C. Bài của Jang Trịnh (tác giả) — tham khảo giọng build-in-public, KHÔNG đăng lại nguyên văn
- https://www.facebook.com/share/p/1MCVjw1rcL/ (30/10): bài dài "Cách mình vận hành design:os như một One-Person Company": kể thật theo mốc ngày (10/10, 11/10, 14/10, 16/10 v0.2.0, 26/10, 29/10), con số thật (ổ đĩa 94%, 207k node...), kể cả phần nhược điểm/sự cố, đội bot mỗi bot một việc.
- https://www.facebook.com/share/p/1TFBUaWQeA/ (29/10): 1 câu "Làm chơi mà đầu tư quá :) ... coming soon v0.7.5" + link Unikorn + #BuildInPublic #Designos #Studio + ảnh chụp UI thật.

## RÚT RA (áp dụng cho mọi bài)
1. Giọng: thành viên cộng đồng chia sẻ thứ mình thấy hay ("bác", "anh em", "mình"), KHÔNG giọng brand/quảng cáo.
2. Hook dòng 1 gọi đúng người trong group + 1 dòng in đậm là tin mới (version/release/sự kiện thật).
3. "Điểm mình thấy hay là..." — 1 nhận định riêng, đặt project khác với lối mòn (vd không phải ô chat AI).
4. Danh sách bullet CỤ THỂ, toàn năng lực có thật (lấy từ README/CHANGELOG/release notes), 6–12 dòng.
5. Câu reframe "từ X sang Y" in đậm.
6. Minh bạch: free, hướng nghiên cứu; nói thật mình có liên quan tới project khi phù hợp.
7. Link repo đầy đủ + link release (hoặc Unikorn).
8. Kết bằng câu hỏi feedback có 2–4 lựa chọn in đậm → kéo comment (bài A 33 comment).
9. 5–9 hashtag.
10. Bài sau trong cùng group: KHÔNG giới thiệu lại dài, chỉ update mới, share lại bài gốc, hỏi câu feedback khác.
11. Video: đúng phong cách release-recap mẫu (nhãn cam nhỏ + headline 1–2 từ to + UI thật crop/zoom + mở/đóng bằng khung selection), bản 30–40s theo mục 16.

## SỬA BỞI NAM (06:03 2/11) — BẮT BUỘC, ghi đè các điểm trên
1. Free là free: chỉ ghi "Free, mã nguồn mở". KHÔNG nhắc gì tới thu phí / kế hoạch thu phí / giá.
2. User không quan tâm tính năng; user quan tâm làm xong thì RA ĐƯỢC CÁI GÌ, ÁP DỤNG VÀO VIỆC GÌ. Mỗi bullet viết dạng "tình huống/việc thật → kết quả nhận được", tính năng chỉ là phương tiện, đặt sau hoặc bỏ. Hook và dòng đậm cũng nói kết quả, không nói tên tính năng.
3. Câu minh bạch giữ: "Mình đang làm cùng team project này..." (không giả làm người ngoài).

## BÀI MẪU ĐÃ ĐƯỢC NAM DUYỆT HƯỚNG (dùng làm khuôn, không copy nguyên)
Có bác nào đang làm Design System mà mỗi lần mở file Figma bên ngoài là sợ vỡ style, mất component thì xem thử cái này:
**DESIGN:OS Studio v0.7 — nhận file .fig, sửa, giao lại mà không hỏng gì.**
Mình đang làm cùng team project này, nên share thẳng nó giúp được gì nhé 😄
Điểm mình thấy hay là nó giúp làm xong việc thật trên file mà không phải ngồi dọn hậu quả:
• Nhận file Figma của khách → mở ngay trên máy, sửa xong lưu lại .fig, gửi trả vẫn đúng style, đúng thứ tự
• Muốn đổi cả bộ màu/typography theo naming của team → làm một lần là xong, lỡ tay thì undo một phát
• Làm card, modal có shadow → export PNG/SVG ra đủ bóng, không bị cắt mép
• Export bao nhiêu lần cũng không đè file cũ → không bao giờ mất bản đã gửi khách
• Cần dựng nhanh một màn hình → nhờ agent (Claude Code, Codex...) làm ngay trong file, xem lại rồi giữ hoặc bỏ cả lượt
Nôm na là từ **"mở được file Figma"** sang **"nhận file, sửa, giao lại cho khách mà không sợ hỏng"**.
Free, mã nguồn mở: https://github.com/jangtrinh/design-os-studio
Anh em thử rồi cho mình xin feedback: khi làm file cho khách, mọi người mất thời gian nhất ở khâu **sửa style, dựng layout hay export bàn giao**?
#DesignOS #Figma #DesignSystems #AIDesign #BuildInPublic

## SỬA BỞI NAM (06:05 2/11) — BẮT BUỘC
4. Giọng build-in-public: "mình và team đang build ra ..." (nói rõ team đang làm ra cái gì, giúp người dùng làm ra cái gì). Thay câu minh bạch cũ bằng kiểu này, vd: "Mình và team đang build DESIGN:OS Studio — một app để nhận file Figma, sửa, giao lại cho khách mà không sợ hỏng."
5. Kênh Facebook: đăng cả trang cá nhân (facebook_timeline) VÀ các cộng đồng/group Facebook liên quan (facebook_member_group), mỗi nơi 1 bài khác nhau, theo cap.
