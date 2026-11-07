package dev.awesome.myworkbench

import org.junit.Assert.*
import org.junit.Test

class CaptureFilterTest {
    @Test fun paymentTemplatesAreAccepted() {
        assertTrue(CaptureFilter.accepts("com.eg.android.AlipayGphone", "支付成功", "向虚构商店付款12.34元"))
        assertTrue(CaptureFilter.accepts("com.tencent.mm", "微信支付", "付款金额 ￥12.34"))
        assertTrue(CaptureFilter.accepts("com.tencent.mm", "微信支付", "扫码支付成功 12.34元"))
        assertTrue(CaptureFilter.accepts("com.tencent.mm", "微信收款", "收款到账12.34元"))
        assertTrue(CaptureFilter.accepts("cmb.pb", "账户变动通知", "您账户支出人民币100.00"))
    }
    @Test fun privateMessagesAndOtpNeverEnterTheQueue() {
        assertFalse(CaptureFilter.accepts("com.tencent.mm", "虚构好友", "给你转账12.34元"))
        assertFalse(CaptureFilter.accepts("com.tencent.mm", "微信支付", "付款12.34元", messaging = true))
        assertFalse(CaptureFilter.accepts("com.eg.android.AlipayGphone", "支付验证码", "付款12.34元 验证码123456"))
        assertFalse(CaptureFilter.accepts("cmb.pb", "交易通知", "付款12.34元 one-time password 123456"))
        assertFalse(CaptureFilter.accepts("cmb.pb", "优惠通知", "支付12.34元立减5元"))
    }
    @Test fun paymentLikeCodePromptsAreRejected() {
        val prompts = listOf(
            "登录码 193431", "登陸碼 193431", "登入碼 193431", "認證碼 193431", "驗證碼 193431",
            "短信码 193431", "短訊碼 193431", "收款码", "收錢碼", "付款碼", "支付码",
            "二維碼", "请勿泄露Passcode", "Security code", "QR code",
            "密码 193431", "密碼 193431", "Password 193431", "ＰＡＳＳＷＯＲＤ 193431"
        )
        for (prompt in prompts) {
            assertFalse(prompt, CaptureFilter.accepts("com.tencent.mm", "微信支付", "支付金额 ¥12.00，$prompt"))
        }
        assertFalse(CaptureFilter.accepts("com.tencent.mm", "微信收款", "请使用收款码收款 12元"))
    }

    @Test fun unrelatedOrAmbiguousNotificationsAreRejected() {
        assertFalse(CaptureFilter.accepts("com.eg.android.AlipayGphone", "虚构好友", "给你转账12.34元"))
        assertFalse(CaptureFilter.accepts("invalid.package", "支付成功", "12.34元"))
        assertFalse(CaptureFilter.accepts("com.eg.android.AlipayGphone", "支付成功", "点击查看金额"))
        assertFalse(CaptureFilter.accepts("com.eg.android.AlipayGphone", "每日账单", "12.34元"))
    }
}
