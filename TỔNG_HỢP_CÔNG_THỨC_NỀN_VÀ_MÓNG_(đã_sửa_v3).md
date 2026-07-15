### TỔNG HỢP CÔNG THỨC THIẾT KẾ ĐỒ ÁN NỀN VÀ MÓNG

Tài liệu này hệ thống hóa các công thức tính toán và kiểm tra theo tiêu chuẩn hiện hành, phục vụ thiết kế các phương án móng nông và móng cọc trong đồ án Nền và Móng.

> **Ghi chú phiên bản đã sửa (đối chiếu với bài mẫu Đề 12):**
> 1. Sửa công thức áp lực giả định dưới đài cọc: dùng $(3d)^2$ thay cho $d^2$ — Mục 6.4.
> 2. Bổ sung số hạng lực cắt $Q \cdot h_m$ vào công thức độ lệch tâm — Phần II.
> 3. Sửa công thức diện tích gây đâm thủng móng nông cho khớp bài mẫu (đoạn consol trừ trọn $h_0$, đúng cạnh) — Mục 5.3.
> 4. Bổ sung bước quy đổi kích thước móng tại đáy đệm cát ($F_y$, $B_y$) — Phần III.
> 5. Bổ sung công thức ráp tổng $R_{cu}$ cho CPT/SPT và hệ số $n=1{,}1$ cho trọng lượng cọc.
> 6. Đánh dấu Phần VII (cấu tạo đài cọc) là chưa kiểm chứng được bằng bài mẫu này.
> 7. Bổ sung dạng tính $\gamma_{dn} = (\gamma_s - \gamma_w)/(1+e)$ ở Phần I (dùng khi đề chỉ cho $\gamma_s$ và $e$).
> 8. Sửa mục 5.1: áp lực tính cấu tạo BTCT dùng phản lực ròng (bỏ $\gamma_{tb}$), xét từng phương một độ lệch tâm — khớp bài mẫu.

---

#### 1\. PHẦN I: ĐÁNH GIÁ ĐIỀU KIỆN ĐỊA CHẤT CÔNG TRÌNH

Dùng để phân loại trạng thái vật lý và tính chất cơ lý của các lớp đất trong trụ địa chất.

* **Độ sệt của đất dính (**$I_L$**):**
$$I_L = \frac{W - W_p}{W_L - W_p}$$
  *Trong đó:* $W$ *là độ ẩm tự nhiên,* $W_L$ *là giới hạn nhão,* $W_p$ *là giới hạn dẻo.*

* **Hệ số rỗng (**$e$**):**
$$e = \frac{\gamma_s(1 + 0{,}01W)}{\gamma} - 1$$
  *Trong đó:* $\gamma_s$ *là trọng lượng riêng hạt,* $\gamma$ *là trọng lượng thể tích tự nhiên.*

* **Trọng lượng thể tích đẩy nổi (**$\gamma_{dn}$**):**
$$\gamma_{dn} = \gamma_{sat} - \gamma_w \quad \text{hoặc} \quad \gamma_{dn} = \frac{\gamma_s - \gamma_w}{1 + e}$$
  *(Thường lấy* $\gamma_w = 10 \, kN/m^3$*; dạng thứ hai dùng khi đề chỉ cho* $\gamma_s$ *và* $e$*, không cho* $\gamma_{sat}$*).*

* **Ứng suất bản thân tại độ sâu $z$ bất kỳ (**$\sigma_z^{bt}$**):**
$$\sigma_z^{bt} = \sum_{i=1}^{n} \gamma_i \cdot h_i$$
  *Trong đó:* $\gamma_i$ *và* $h_i$ *lần lượt là trọng lượng thể tích và chiều dày lớp đất thứ* $i$.
  *Lưu ý: Khi lớp đất nằm dưới mực nước ngầm (MNN), dùng* $\gamma_{dn,i}$ *thay cho* $\gamma_i$. *Tại MNN có bước nhảy ứng suất do chuyển đổi* $\gamma \to \gamma_{dn}$.

  Ví dụ chi tiết:
  - Tại đáy lớp 1: $\sigma_{z1}^{bt} = \gamma_1 \cdot h_1$
  - Tại MNN (nếu MNN nằm trong lớp 2, cách mặt đất $d_{nn}$): $\sigma_{MNN}^{bt} = \gamma_1 h_1 + \gamma_2 (d_{nn} - h_1)$
  - Từ MNN trở xuống, lớp đất dùng $\gamma_{dn}$: $\sigma_{z}^{bt} = \sigma_{MNN}^{bt} + \gamma_{dn,2} \cdot \Delta h_2 + \gamma_{dn,3} \cdot h_3 + \ldots$

* **Phân loại trạng thái đất dựa trên** $I_L$ **(Theo dữ liệu thực tế đồ án):**
  * $I_L < 0$: Trạng thái cứng.
  * $0 \le I_L \le 0{,}25$: Trạng thái nửa cứng (dẻo cứng).
  * $0{,}25 < I_L \le 0{,}5$: Trạng thái dẻo vừa (dẻo cứng).
  * $0{,}5 < I_L \le 0{,}75$: Trạng thái dẻo mềm.
  * $0{,}75 < I_L \le 1{,}0$: Trạng thái dẻo nhão.
  * $I_L > 1{,}0$: Trạng thái nhão (chảy).

---

#### 2\. PHẦN II: MÓNG NÔNG TRÊN NỀN THIÊN NHIÊN

Xác định cường độ đất nền và kiểm tra điều kiện áp lực tại đáy móng.

* **Tải trọng tiêu chuẩn tại đỉnh móng:**
$$N^{tc} = \frac{N^{tt}}{n}; \quad M^{tc} = \frac{M^{tt}}{n}; \quad Q^{tc} = \frac{Q^{tt}}{n}$$
  *(Hệ số vượt tải* $n = 1{,}15$*)*.

* **Cường độ tính toán của đất nền (**$R$**):**
$$R = \frac{m_1 m_2}{K_{tc}} \left( A \cdot b \cdot \gamma_{II} + B \cdot h \cdot \gamma_{II}' + D \cdot c_{II} - \gamma_{II}' \cdot h_0 \right)$$
  *Định nghĩa các thông số:*

  | Ký hiệu | Ý nghĩa |
  | :--- | :--- |
  | $m_1, m_2$ | Hệ số điều kiện làm việc của nền đất và công trình |
  | $K_{tc}$ | Hệ số tin cậy (bằng 1,0 nếu chỉ tiêu lấy từ thí nghiệm trực tiếp) |
  | $A, B, D$ | Hệ số không thứ nguyên tra theo góc ma sát trong $\varphi_{II}$ |
  | $b, h$ | Bề rộng đáy móng và chiều sâu chôn móng tính từ mặt đất tự nhiên |
  | $\gamma_{II}$ | Trọng lượng thể tích lớp đất dưới đáy móng |
  | $\gamma_{II}'$ | Trọng lượng thể tích TB các lớp đất từ mặt đất đến đáy móng: $\gamma_{II}' = \frac{\sum \gamma_i h_i}{\sum h_i}$ |

* **Xác định diện tích sơ bộ đáy móng (phương pháp lặp):**

  *Bước 1:* Ước lượng diện tích đáy móng ban đầu:
$$F_{sb} = \frac{N^{tc}}{R_0 - \gamma_{tb} \cdot h}$$
  *Trong đó:* $R_0$ *là cường độ quy ước tra bảng (theo* $e$ *và* $I_L$ *của lớp đất tại đáy móng);* $\gamma_{tb} \approx 20 \, kN/m^3$.

  *Bước 2:* Từ $F_{sb}$ suy ra cạnh sơ bộ: $b_{dt} = \sqrt{F_{sb}}$ (nếu giả thiết móng vuông).

  *Bước 3:* Tính độ lệch tâm (mômen lấy tại **đáy móng**, gồm mômen ở đỉnh cộng phần do lực cắt truyền qua chiều cao móng $h_m$):
$$e_l = \frac{M_l^{tc} + Q^{tc} \cdot h_m}{N^{tc}} \quad ; \quad e_b = \frac{M_b^{tc} + Q^{tc} \cdot h_m}{N^{tc}}$$
  *Trong đó* $h_m$ *là chiều cao móng; lực cắt* $Q^{tc}$ *lấy theo phương vuông góc tương ứng. (Bài mẫu:* $e_l = \frac{M_{0x}^{tc} + Q_{0y}^{tc} h_m}{N_0^{tc}}$ *;* $e_b = \frac{M_{0y}^{tc} + Q_{0x}^{tc} h_m}{N_0^{tc}}$*).*

  *Bước 4:* Xác định kích thước thực tế:
$$b = b_{dt} + 2e_b \quad ; \quad l = b_{dt} + 2e_l$$
  *(Làm tròn lên bội số 0,1 m)*

  *Bước 5:* Tính lại $R$ theo công thức đầy đủ với $b$ mới. Nếu chưa thỏa mãn điều kiện áp lực thì quay lại Bước 2 với $b$ mới.

* **Áp lực tại đáy móng (**$P^{tc}$**):**
  * Áp lực trung bình: $P_{tb}^{tc} = \frac{N^{tc}}{l \cdot b} + \gamma_{tb} (h + h_{tn})$
  * Áp lực lớn nhất/nhỏ nhất: $P_{max/min}^{tc} = \frac{N^{tc}}{l \cdot b} \left( 1 \pm \frac{6e_l}{l} \pm \frac{6e_b}{b} \right) + \gamma_{tb} (h + h_{tn})$
  *(Với* $\gamma_{tb} = 20 \, kN/m^3$ *;* $h_{tn}$ *là độ chênh cốt trong nhà và ngoài nhà)*.

* **Điều kiện kiểm tra áp lực:**
  * $P_{tb}^{tc} \le R$
  * $P_{max}^{tc} \le 1{,}2R$ (hoặc $1{,}5R$ khi tính tổ hợp có tải trọng gió).
  * $P_{min}^{tc} > 0$ (không cho phép xuất hiện vùng mất liên kết).

* **Điều kiện kiểm tra kinh tế:**
$$\frac{R - P_{tb}^{tc}}{R} \le 0{,}1 \quad (\text{tức chênh lệch không quá 10\%})$$
  *Nếu chênh lệch quá lớn, cần giảm kích thước móng để tối ưu vật liệu.*

---

#### 3\. PHẦN III: MÓNG NÔNG TRÊN ĐỆM CÁT

Sử dụng khi cần thay thế lớp đất yếu bằng vật liệu cát hạt trung/thô để tăng khả năng chịu lực.

* **Cường độ tính toán của đệm cát (**$R$**):** Theo TCVN 9362:2012
$$R = R_0 \left( 1 + K_1 \frac{b - b_1}{b_1} \right) \frac{h + h_1}{2h_1}$$
  *Trong đó:* $R_0$ *là cường độ quy ước (ví dụ* $400 \, kPa$*);* $K_1 = 0{,}125$ *với cát.*

* **Kiểm tra áp lực tại mặt lớp đất yếu (đáy đệm cát):**
$$\sigma_{z}^{bt} + \sigma_{z}^{gl} \le R_{dy}$$
  * $\sigma_{z}^{bt}$: Ứng suất bản thân tại cốt đáy đệm.
  * $\sigma_{z}^{gl} = K_0(P_{tb}^{tc} - \sigma_{z=h}^{bt})$: Ứng suất gây lún truyền xuống mặt lớp đất yếu.
  * $R_{dy}$: Cường độ tính toán của lớp đất yếu tại độ sâu đặt đệm (tính theo công thức $R$ ở Phần II với $h_y = h + h_{đ}$).

* **Quy đổi kích thước móng tại đáy đệm cát (để tính $R_{dy}$):** Vì tải lan truyền xuống nên móng quy đổi tại mặt lớp yếu rộng hơn đáy móng thực:
  * Diện tích móng quy đổi: $F_y = \dfrac{N^{tc}}{\sigma_{z=h_đ}^{gl}}$
  * Cạnh móng quy đổi (giả thiết tỉ lệ cạnh không đổi): $B_y = \sqrt{F_y + \Delta^2} - \Delta \quad ; \quad \Delta = \dfrac{l - b}{2}$
  * Sau đó thay $B_y$ vào vai trò bề rộng $b$ trong công thức $R_{dy}$:
$$R_{dy} = \frac{m_1 m_2}{K_{tc}} \left( A \cdot B_y \cdot \gamma_{II} + B \cdot h_y \cdot \gamma_{II}' + D \cdot c_{II} \right)$$
  *Trong đó* $\gamma_{II}$ *là trọng lượng thể tích lớp đất yếu dưới đệm;* $\gamma_{II}'$ *là TB các lớp tự nhiên từ mặt đất đến đáy đệm;* $h_y = h + h_đ$.

* **Kích thước lớp đệm cát:**
  * $b_đ = b + 2 \cdot h_đ \cdot \tan\alpha$
  * $l_đ = l + 2 \cdot h_đ \cdot \tan\alpha$
  *(Góc truyền lực* $\alpha = 30^\circ$*)*.

---

#### 4\. PHẦN IV: TÍNH TOÁN BIẾN DẠNG (LÚN)

Quy trình tính lún theo phương pháp cộng lún các lớp phân tố (TCVN 9362:2012).

* **Ứng suất gây lún tại đáy móng:**
$\sigma_{z=0}^{gl} = P_{tb}^{tc} - \sigma_{z=h}^{bt}$

* **Ứng suất gây lún tại tâm lớp phân tố** $i$**:**
$\sigma_{zi}^{gl} = K_{0i} \cdot \sigma_{z=0}^{gl}$

* **Độ lún tổng cộng (**$S$**):**
$$S = \sum_{i=1}^{n} \frac{\beta \cdot \sigma_{zi}^{gl} \cdot h_i}{E_i}$$
  * $h_i$: Chiều dày lớp phân tố (điều kiện $h_i \le b/4$).
  * $\beta = 0{,}8$: Hệ số đầy.
  * $E_i$: Mô đun biến dạng lớp đất $i$.

* **Điều kiện dừng lún:**
$\sigma_{z}^{gl} \le 0{,}2 \cdot \sigma_{z}^{bt}$ (Nếu đất yếu $\sigma_{z}^{gl} \le 0{,}1 \cdot \sigma_{z}^{bt}$).

* **Điều kiện giới hạn lún:** $S \le S_{gh}$
  *(Thông thường* $S_{gh} = 8 \, cm$ *cho nhà khung BTCT)*.

---

#### 5\. PHẦN V: TÍNH TOÁN CẤU TẠO BÊ TÔNG CỐT THÉP (MÓNG NÔNG)

Xác định chiều cao móng chống chọc thủng và diện tích cốt thép.

##### 5.1. Áp lực tính toán tại đáy móng

Khi tính cấu tạo BTCT dùng **tải trọng tính toán**. Áp lực dùng để tính chọc thủng và uốn là **phản lực ròng của đất do tải trọng từ cột gây ra**, **không cộng** $\gamma_{tb}(h+h_{tn})$ (trọng lượng đất và móng không gây uốn bản móng). Khi kiểm tra theo phương nào thì chỉ xét độ lệch tâm theo phương đó:

* Theo phương $l$: $\quad P_{max/min}^{tt} = \dfrac{N^{tt}}{l \cdot b}\left(1 \pm \dfrac{6e_l}{l}\right)$
* Theo phương $b$: $\quad P_{max/min}^{tt} = \dfrac{N^{tt}}{l \cdot b}\left(1 \pm \dfrac{6e_b}{b}\right)$

*(Độ lệch tâm $e_l, e_b$ lấy như ở Phần II — bằng nhau cho cả trị tiêu chuẩn và tính toán vì $M$ và $N$ cùng nhân hệ số $n$.)*

##### 5.2. Chiều cao làm việc của móng

* Chọn lớp bê tông bảo vệ $a_0$ (thường $a_0 = 0{,}05 \, m$ hoặc $0{,}035 \, m$).
* Chiều cao làm việc: $h_0 = h_m - a_0$

##### 5.3. Kiểm tra chống chọc thủng (kiểm tra riêng từng phương)

**Phương b (mặt chống đâm thủng có cạnh $b_{tb}$):**
* Chu vi (cạnh) trung bình tháp chọc thủng: $b_{tb} = b_c + h_0$
* Đoạn vươn (consol) gây đâm thủng — đo theo phương $l$, **trừ trọn $h_0$**:
$$c = \frac{l}{2} - \frac{l_c}{2} - h_0 = \frac{l - l_c}{2} - h_0$$
* Áp lực tính toán trung bình trong phạm vi diện tích gây đâm thủng $P_{ct}^{tt}$ *(nội suy tuyến tính từ biểu đồ áp lực $P_{max}^{tt}, P_{min}^{tt}$ rồi lấy trung bình với $P_{max}^{tt}$)*
* Lực đâm thủng:
$$N_{ct} = P_{ct}^{tt} \cdot b \cdot c$$
* Lực chống đâm thủng: $\alpha \cdot R_{bt} \cdot h_0 \cdot b_{tb}$
* Điều kiện: $N_{ct} \le \alpha \cdot R_{bt} \cdot h_0 \cdot b_{tb}$

**Phương l (mặt chống đâm thủng có cạnh $l_{tb}$):**
* Cạnh trung bình tháp chọc thủng: $l_{tb} = l_c + h_0$
* Đoạn vươn (consol) gây đâm thủng — đo theo phương $b$:
$$d = \frac{b}{2} - \frac{b_c}{2} - h_0 = \frac{b - b_c}{2} - h_0$$
* Lực đâm thủng:
$$N_{ct} = P_{ct}^{tt} \cdot l \cdot d$$
* Điều kiện: $N_{ct} \le \alpha \cdot R_{bt} \cdot h_0 \cdot l_{tb}$

*Trong đó:* $\alpha = 1$ *cho bê tông nặng;* $R_{bt}$ *là cường độ chịu kéo của bê tông;* $b_c, l_c$ *là kích thước tiết diện cột.*

> Nếu **không thỏa mãn** ở phương nào thì cần tăng $h_m$ (chiều cao móng) và kiểm tra lại.

##### 5.4. Tính toán mô men tại mặt ngàm mép cột

**Mô men tương ứng với mặt ngàm I-I (phương cạnh $l$):**
$$M_I = \frac{L_I^2}{6} \left( 2P_{max}^{tt} + P_1^{tt} \right) \cdot b$$
*Trong đó:*
* $L_I = \frac{l - l_c}{2}$: Chiều dài tay đòn (consol) từ mép cột đến mép móng theo phương $l$.
* $P_1^{tt}$: Áp lực tính toán tại vị trí mặt ngàm (nội suy tuyến tính từ $P_{max}^{tt}$ và $P_{min}^{tt}$):
$$P_1^{tt} = P_{min}^{tt} + (P_{max}^{tt} - P_{min}^{tt}) \cdot \frac{l - L_I}{l}$$

**Mô men tương ứng với mặt ngàm II-II (phương cạnh $b$):**
$$M_{II} = \frac{L_{II}^2}{6} \left( 2P_{max,b}^{tt} + P_2^{tt} \right) \cdot l$$
*Trong đó:*
* $L_{II} = \frac{b - b_c}{2}$: Chiều dài consol theo phương $b$.
* Tương tự nội suy $P_2^{tt}$ theo phương $b$.

##### 5.5. Diện tích cốt thép

**Thép phương I (đặt lớp dưới):**
$$A_{s,I} = \frac{M_I}{0{,}9 \cdot h_0 \cdot R_s}$$

**Thép phương II (đặt lớp trên):**
$$A_{s,II} = \frac{M_{II}}{0{,}9 \cdot h_0' \cdot R_s}$$
*Trong đó chiều cao làm việc hiệu dụng phương II:*
$$h_0' = h_0 - \frac{\phi_I}{2} - \frac{\phi_{II}}{2} \approx h_0 - \phi$$
*($\phi_I$, $\phi_{II}$ là đường kính cốt thép phương I và phương II).*

##### 5.6. Quy trình chọn và bố trí cốt thép

*Bước 1:* Chọn đường kính thanh thép $\phi$ (ví dụ $\phi 16$), tra diện tích 1 thanh $a_s$ (ví dụ $a_s = 2{,}01 \, cm^2$ cho $\phi 16$).

*Bước 2:* Tính số thanh:
$$n = \left\lceil \frac{A_s}{a_s} \right\rceil$$
*(Làm tròn lên số nguyên)*

*Bước 3:* Chiều dài mỗi thanh:
$$l_{thanh} = b - 2c_{bv} \quad \text{(thép phương I)}$$
$$l_{thanh} = l - 2c_{bv} \quad \text{(thép phương II)}$$
*Với* $c_{bv}$ *là lớp bê tông bảo vệ (thường* $c_{bv} = 35 \, mm$*).*

*Bước 4:* Khoảng cách giữa hai trục cốt thép:
$$a = \frac{l - 2c_{bv}}{n - 1} \quad \text{(thép phương I, bố trí dọc theo cạnh } l \text{)}$$
$$a = \frac{b - 2c_{bv}}{n - 1} \quad \text{(thép phương II, bố trí dọc theo cạnh } b \text{)}$$
*(Làm tròn xuống bội số 10 mm, thường chọn $a = 100 \div 200 \, mm$).*

---

#### 6\. PHẦN VI: MÓNG CỌC

Tổng hợp sức chịu tải, xác định số lượng cọc, bố trí cọc, và kiểm tra nội lực đầu cọc.

##### 6.1. Sức chịu tải theo vật liệu ($P_{vl}$)

$$P_{vl} = \varphi (R_b A_b + R_{sc} A_s)$$
*Trong đó:* $\varphi = 1$ *cho móng cọc đài thấp, cọc không xuyên qua bùn/than bùn;* $A_b$ *là diện tích tiết diện bê tông;* $A_s$ *là diện tích cốt thép dọc.*

##### 6.2. Sức chịu tải cực hạn theo đất nền ($R_{cu}$)

Tính theo 3 phương pháp và chọn giá trị nhỏ nhất:

**a) Thí nghiệm trong phòng (Lab) – TCVN 10304:2014:**
$$R_{cu} = \gamma_c \left( \gamma_{cq} \cdot q_b \cdot A_b + u \sum \gamma_{cf} \cdot f_i \cdot l_i \right)$$
*Trong đó:* $\gamma_c = 1$; $\gamma_{cq}, \gamma_{cf}$ *là hệ số điều kiện làm việc (tra bảng 4 TCVN 10304);* $q_b$ *tra bảng 2;* $f_i$ *tra bảng 3.*

**b) Xuyên tĩnh (CPT):**
Công thức tổng: $R_{cu} = q_b \cdot A_b + u \sum f_i \cdot l_i$, với:
* $q_b = k \cdot q_c$ *(k tra bảng G.2 TCVN 10304)*
* $f_i = q_{ci} / \alpha_i$ *(khống chế* $f_i \le f_{max}$*)*

**c) Xuyên tiêu chuẩn (SPT):**
Công thức tổng: $R_{cu} = q_b \cdot A_b + u \sum f_i \cdot l_i$, với:
* $q_b = 300 \cdot N_p$ *(cho cọc đóng trong đất rời)*
* $f_i$ tính theo loại đất rời/dính:
  - Đất rời: $f_{s,i} = \frac{10 \cdot N_{s,i}}{3}$
  - Đất dính: $f_{c,i} = f_L \cdot \alpha_p \cdot c_{u,i}$ *(với* $c_{u,i} = 7{,}14 N_i$*)*

##### 6.3. Sức chịu tải tính toán ($P_{tt}$)

$$P_{tt} = \min(P_{vl},\; P_{Lab},\; P_{CPT},\; P_{SPT})$$

##### 6.4. Xác định số lượng cọc sơ bộ và kích thước đài

*Bước 1:* Áp lực phản lực giả định của nền dưới đài:
$$p_{gd} = \frac{P_{tt}}{(3d)^2}$$
*Trong đó* $d$ *là cạnh tiết diện cọc (ví dụ* $d = 0{,}25 \, m$*);* $3d$ *là khoảng cách tối thiểu giữa hai tim cọc, nên* $(3d)^2$ *là diện tích chịu tải quy cho một cọc. (Bài mẫu:* $p_{gd} = \frac{641}{(3 \times 0{,}25)^2} = 1139{,}55 \, kPa$*).*

*Bước 2:* Diện tích sơ bộ đáy đài:
$$F_{đài} = \frac{N^{tt}}{p_{gd} - n \cdot \gamma_{tb} \cdot h_{đài}}$$
*Trong đó* $n = 1{,}1$ *(hệ số kể đến trọng lượng đài và đất trên đài);* $\gamma_{tb} \approx 20 \, kN/m^3$; $h_{đài}$ *là chiều sâu chôn đài tính từ mặt đất tự nhiên.*

*Bước 3:* Số lượng cọc sơ bộ:
$$n_{c,sb} = \frac{N^{tt} + n \cdot F_{đài} \cdot \gamma_{tb} \cdot h_{đài}}{P_{tt}}$$
*(Làm tròn lên số nguyên, thường chọn bố trí 3, 4, 5, 6, 7, 9... cọc theo sơ đồ chuẩn).*

*Bước 4:* Bố trí cọc và xác định kích thước đài thực tế:
* Khoảng cách tối thiểu giữa 2 tim cọc: $\ge 3d$
* Khoảng cách từ mép đài đến tim cọc biên: $\ge 0{,}7d$ *(thường chọn* $d$*)*
* Kích thước đài $b_{đ} \times l_{đ}$ xác định từ bố trí thực tế.

*Bước 5:* Trọng lượng thực tế của đài và đất trên đài:
$$N_{đài+đất}^{tt} = n \cdot F_{đài} \cdot h_{đài} \cdot \gamma_{tb}$$
*(Với* $n = 1{,}1$*;* $F_{đài} = b_{đ} \times l_{đ}$*)*

##### 6.5. Nội lực tính toán thực tế tại đáy đài

Nội lực tại đáy đài **khác** với nội lực tại đỉnh đài do có thêm trọng lượng đài và mô men do lực cắt:
$$N^{tt} = N_{đỉnh}^{tt} + N_{đài+đất}^{tt}$$
$$M_x^{tt} = M_{x,đỉnh}^{tt} + Q_y^{tt} \cdot h_{đ}$$
$$M_y^{tt} = M_{y,đỉnh}^{tt} + Q_x^{tt} \cdot h_{đ}$$
*Trong đó* $h_{đ}$ *là chiều cao đài cọc.*

##### 6.6. Kiểm tra lực nén đầu cọc

$$P_{max/min}^{tt} = \frac{N^{tt}}{n_c} + \frac{M_y^{tt} \cdot x_{max}}{\sum x_i^2} + \frac{M_x^{tt} \cdot y_{max}}{\sum y_i^2}$$

##### 6.7. Trọng lượng bản thân cọc ($P_c$)

$$P_c = n \cdot A_b \left( \gamma_{bt} \cdot L_{trên\,MNN} + \gamma_{dn,bt} \cdot L_{dưới\,MNN} \right)$$
*Trong đó:*
* $n = 1{,}1$ (hệ số vượt tải kể đến trọng lượng bản thân cọc).
* $\gamma_{bt} = 25 \, kN/m^3$ (trọng lượng thể tích bê tông cốt thép).
* $\gamma_{dn,bt} = 25 - 10 = 15 \, kN/m^3$ (phần cọc ngập dưới mực nước ngầm).
* $L_{trên\,MNN}$, $L_{dưới\,MNN}$: chiều dài cọc nằm trên/dưới MNN.

##### 6.8. Điều kiện kiểm tra

* $P_{max}^{tt} + P_c \le P_{tt}$ *(Điều kiện sức chịu tải)*
* $P_{min}^{tt} > 0$ *(Điều kiện không xuất hiện lực nhổ)*

* **Kiểm tra sự hợp lý về số lượng cọc:**
$$\mu = \frac{P_{max}^{tt} + P_c}{P_{tt}} \ge 0{,}7 \quad \text{(hoặc gần 1,0)}$$
*Nếu* $\mu$ *quá nhỏ thì lãng phí cọc, cần giảm số lượng cọc.*

---

#### 7\. PHẦN VII: TÍNH TOÁN CẤU TẠO BÊ TÔNG CỐT THÉP ĐÀI CỌC

> **Lưu ý:** Phần này **không xuất hiện** trong bài mẫu Đề 12 (bài mẫu kết thúc ở bước kiểm tra số lượng cọc), nên các công thức dưới đây **chưa được đối chiếu/kiểm chứng** bằng bài mẫu. Cần kiểm tra lại với giáo trình hoặc một bài mẫu khác trước khi áp dụng.

##### 7.1. Chiều cao đài cọc – Kiểm tra chống chọc thủng

Tháp chọc thủng nghiêng $45°$ từ mép cột xuống. Kiểm tra tương tự móng nông nhưng lực đâm thủng tính từ **phản lực các cọc nằm ngoài tháp chọc thủng**.

**Phương b:**
* $b_{tb} = b_c + h_0$
* Lực đâm thủng = tổng phản lực các cọc nằm ngoài tháp chọc thủng (phía cạnh $b$):
$$N_{ct} = \sum P_i \quad \text{(các cọc ngoài tháp)}$$
* Điều kiện: $N_{ct} \le \alpha \cdot R_{bt} \cdot h_0 \cdot b_{tb}$

**Phương l:**
* $l_{tb} = l_c + h_0$
* Tương tự, lấy tổng phản lực cọc ngoài tháp theo phương $l$.
* Điều kiện: $N_{ct} \le \alpha \cdot R_{bt} \cdot h_0 \cdot l_{tb}$

> Nếu **không thỏa mãn**, tăng $h_{đ}$ và kiểm tra lại.

##### 7.2. Tính cốt thép đài cọc

Quan niệm đài cọc như consol ngàm tại mép cột. Mô men tại mặt ngàm tính bằng **tổng mô men của các phản lực cọc** nằm ngoài mặt ngàm nhân với khoảng cách từ tim cọc đến mặt ngàm.

**Mô men tại mặt ngàm I-I (tính thép phương cạnh $l$):**
$$M_I = \sum P_i \cdot r_i$$
*Trong đó:* $P_i$ *là phản lực đầu cọc thứ* $i$ *nằm ngoài mặt ngàm I-I;* $r_i$ *là khoảng cách từ tim cọc* $i$ *đến mặt ngàm I-I (mép cột theo phương* $l$*).*

**Mô men tại mặt ngàm II-II (tính thép phương cạnh $b$):**
$$M_{II} = \sum P_j \cdot r_j$$

**Diện tích cốt thép:**
$$A_{s,I} = \frac{M_I}{0{,}9 \cdot h_0 \cdot R_s}$$
$$A_{s,II} = \frac{M_{II}}{0{,}9 \cdot h_0' \cdot R_s}$$

*Chọn và bố trí thép tương tự quy trình ở Phần V (mục 5.6).*

---

#### PHỤ LỤC: BẢNG TRA THƯỜNG DÙNG

| Bảng | Nội dung | Nguồn |
|------|----------|-------|
| Bảng 2 | Cường độ sức kháng đất dưới mũi cọc $q_b$ | TCVN 10304:2014 |
| Bảng 3 | Cường độ sức kháng ma sát thân cọc $f_i$ | TCVN 10304:2014 |
| Bảng 4 | Hệ số $\gamma_{cq}$, $\gamma_{cf}$ theo phương pháp hạ cọc | TCVN 10304:2014 |
| Bảng G.2 | Hệ số $k$, $\alpha_i$ cho xuyên tĩnh CPT | TCVN 10304:2014 |
| Bảng 3-1 | Hệ số $m_1$ theo trạng thái đất | TCVN 9362:2012 |
| Bảng 3-2 | Hệ số $A$, $B$, $D$ theo $\varphi_{II}$ | TCVN 9362:2012 |
| Bảng D.1 | Cường độ quy ước $R_0$ theo $e$ và $I_L$ | TCVN 9362:2012 |
| Phụ lục C | Hệ số $K_0$ (ứng suất gây lún) theo $2z/b$ và $l/b$ | TCVN 9362:2012 |
