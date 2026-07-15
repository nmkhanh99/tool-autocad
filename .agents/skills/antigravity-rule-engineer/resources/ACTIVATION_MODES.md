## 4 Activation Modes Chính Thức (theo antigravity.google/docs/rules-workflows)

1. **Always On**  
   Áp dụng mọi lúc, mọi task.  
   Dùng khi: quy tắc phải luôn đúng (ví dụ: Conventional Commits).

2. **Manual**  
   Chỉ kích hoạt khi bạn gõ `@tên-rule` trong chat Agent.  
   Dùng khi: rule chỉ cần thi thoảng.

3. **Model Decision**  
   Agent tự quyết định dựa trên nội dung rule.  
   Dùng khi: rule phức tạp, cần ngữ cảnh.

4. **Glob**  
   Chỉ áp dụng cho file khớp pattern.  
   Ví dụ: `Glob: src/**/*.ts` hoặc `Glob: **/*.py`  
   Dùng khi: rule chỉ dành cho loại file cụ thể.